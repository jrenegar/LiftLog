// Main application logic moved from inline HTML into this module.
// For backward compatibility with inline onclick attributes, we expose important functions
// onto `window` at the end of the file.

/* TIMERS: timestamp-driven implementation */
let countdownInterval = null;
let countdownDuration = 0; // seconds requested
let countdownEndTime = null; // timestamp (ms) when countdown should finish
let countdownPaused = false;
let countdownPausedRemaining = 0; // seconds remaining when paused

let elapsedInterval = null;
let elapsedStartTime = null; // timestamp (ms) when elapsed began (taking accumulated into account)
let elapsedAccumulated = 0; // seconds accumulated before current run
let elapsedRunning = false;

let pouchDB = null;
let historyDocs = [];
let historyIndex = 0;

function pad2(n) { return n.toString().padStart(2, '0'); }
function formatTimeSeconds(s) {
    if (s <= 0) return '00:00';
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${pad2(mm)}:${pad2(ss)}`;
}

function updateCountdownDisplay() {
    let remainingSec = 0;
    if (countdownEndTime) {
        const remMs = countdownEndTime - Date.now();
        remainingSec = Math.max(0, Math.ceil(remMs / 1000));
    } else if (countdownPaused) {
        remainingSec = Math.max(0, Math.ceil(countdownPausedRemaining));
    }
    const el = document.getElementById('countdownDisplay');
    if (el) el.textContent = formatTimeSeconds(remainingSec);
}

function updateElapsedDisplay() {
    let elapsedSec = elapsedAccumulated;
    if (elapsedStartTime) {
        elapsedSec = Math.floor((Date.now() - elapsedStartTime) / 1000);
    }
    const el = document.getElementById('elapsedDisplay');
    if (el) el.textContent = formatTimeSeconds(elapsedSec);
}

function startElapsed() {
    if (elapsedRunning) return;
    elapsedStartTime = Date.now() - elapsedAccumulated * 1000;
    elapsedRunning = true;
    if (elapsedInterval) clearInterval(elapsedInterval);
    elapsedInterval = setInterval(updateElapsedDisplay, 500);
    updateElapsedDisplay();
}

function stopElapsed() {
    if (!elapsedRunning) return;
    elapsedAccumulated = Math.floor((Date.now() - elapsedStartTime) / 1000);
    elapsedStartTime = null;
    elapsedRunning = false;
    if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
    updateElapsedDisplay();
}

function resetElapsed() {
    if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
    elapsedStartTime = null;
    elapsedAccumulated = 0;
    elapsedRunning = false;
    updateElapsedDisplay();
}

function startCountdown(seconds) {
    if (typeof seconds === 'number') {
        countdownDuration = Math.max(0, Math.floor(seconds));
        countdownEndTime = Date.now() + countdownDuration * 1000;
        countdownPaused = false;
        countdownPausedRemaining = 0;
    } else if (countdownPaused && countdownPausedRemaining > 0) {
        countdownEndTime = Date.now() + Math.floor(countdownPausedRemaining) * 1000;
        countdownPaused = false;
        countdownPausedRemaining = 0;
    }

    startElapsed();

    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        if (!countdownEndTime) return updateCountdownDisplay();
        const remMs = countdownEndTime - Date.now();
        if (remMs <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            countdownEndTime = null;
            countdownPaused = false;
            countdownPausedRemaining = 0;
            updateCountdownDisplay();
            try {
                const bar = document.querySelector('.top-bar');
                if (bar) {
                    bar.classList.add('flash');
                    const onAnimEnd = function () {
                        bar.classList.remove('flash');
                        bar.removeEventListener('animationend', onAnimEnd);
                    };
                    bar.addEventListener('animationend', onAnimEnd);
                }
                try { playBeep(350, 880, 0.12); } catch (e) {}
                try { if (navigator.vibrate) navigator.vibrate([200,100,200]); } catch (e) {}
            } catch (e) { /* ignore */ }
            return;
        }
        updateCountdownDisplay();
    }, 250);
    updateCountdownDisplay();
}

function stopCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    if (countdownEndTime) {
        const remMs = countdownEndTime - Date.now();
        countdownPausedRemaining = Math.max(0, Math.ceil(remMs / 1000));
        countdownEndTime = null;
        countdownPaused = true;
    }
    updateCountdownDisplay();
}

function resetCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    countdownEndTime = null;
    countdownPaused = false;
    countdownPausedRemaining = 0;
    updateCountdownDisplay();
}

function playBeep(duration = 300, frequency = 880, volume = 0.12) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = frequency;
        g.gain.value = volume;
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        setTimeout(() => {
            try { o.stop(); } catch (e) {}
            try { g.disconnect(); } catch (e) {}
            try { o.disconnect(); } catch (e) {}
            if (ctx.close) ctx.close();
        }, duration);
    } catch (e) {}
}

/* ---------------- EXERCISE CREATION ---------------- */
function addExercise(nameOverride = null) {
    const name = nameOverride || document.getElementById("exerciseSelect").value;
    if (!name.trim()) return;
    closeAddExerciseModal();
    createExerciseBlock(name);
    saveData();
}

function createExerciseBlock(name, comment = "", sets = [], setsImported = false) {
    const block = document.createElement("div");
    block.className = "exercise-block";
    block.setAttribute("data-exercise", name);
    block.setAttribute("draggable", "true");

    block.innerHTML = `
        <div class="exercise-header">
            <h3>${name}</h3>
            <div style="display:flex; gap:8px; align-items:center;">
                <button class="comment-toggle" title="Comment">...</button>
                <button class="delete-exercise-btn">×</button>
            </div>
        </div>
        <textarea class="comment" placeholder="Add comment...">${comment}</textarea>
        <div class="sets"></div>
        <button class="add-btn" title="Add set">+</button>
    `;

    document.getElementById("logContainer").appendChild(block);

    // attach listeners for the created controls
    const commentToggle = block.querySelector('.comment-toggle');
    const commentBox = block.querySelector('.comment');
    const deleteExerciseBtn = block.querySelector('.delete-exercise-btn');
    const addBtn = block.querySelector('.add-btn');

    commentToggle.addEventListener('click', () => {
        const isVisible = commentBox.style.display === 'block';
        commentBox.style.display = isVisible ? 'none' : 'block';
        commentToggle.title = isVisible ? 'Comment' : 'Hide Comment';
        saveData();
    });

    deleteExerciseBtn.addEventListener('click', () => {
        if (confirm(`Delete exercise "${block.getAttribute('data-exercise')}"?`)) { block.remove(); saveData(); }
    });

    addBtn.addEventListener('click', () => addSet(addBtn));

    sets.forEach(s => addSet(block.querySelector('.add-btn'), s.weight, s.reps, setsImported));

    if (comment.trim() !== "") {
        commentBox.style.display = "block";
        commentToggle.title = "Hide Comment";
    }

    addDragAndDrop(block);
}

function addSet(button, weight = "", reps = "", imported = false) {
    const setsDiv = button.parentElement.querySelector(".sets");
    const row = document.createElement("div");
    row.className = "set-row";
    row.innerHTML = `
        <input type="text" class="weight" placeholder="Weight" value="${weight}" 
               inputmode="decimal" pattern="[0-9]*">
        <input type="text" class="reps" placeholder="Reps" value="${reps}" 
               inputmode="numeric" pattern="[0-9]*">
        <button class="delete-btn">×</button>
    `;
    setsDiv.appendChild(row);

    const repsInput = row.querySelector('.reps');
    const weightInput = row.querySelector('.weight');
    const delBtn = row.querySelector('.delete-btn');

    // wire inputs to save
    [repsInput, weightInput].forEach(inp => inp.addEventListener('input', saveData));

    delBtn.addEventListener('click', () => { row.remove(); saveData(); });

    if (imported && repsInput && repsInput.value.trim() !== '') {
        repsInput.classList.add('imported-rep');
        repsInput.addEventListener('focus', function () { this.classList.remove('imported-rep'); saveData(); });
    }

    saveData();
}

/* ---------------- IMPORT FUNCTION ---------------- */
function importExercises() {
    const text = document.getElementById("importText").value.trim();
    if (!text) { closeImportModal(); return; }

    const lines = text.split("\n").map(l => l.trim()).filter(l => l);

    let lastCreated = null;
    lines.forEach(line => {
        if (!line) return;
        if (line.startsWith(";")) {
            const comment = line.substring(1).trim();
            if (lastCreated) {
                const commentBox = lastCreated.querySelector('.comment');
                commentBox.value = comment;
                commentBox.style.display = 'block';
                lastCreated.querySelector('.comment-toggle').title = 'Hide Comment';
            }
            return;
        }

        const parts = line.split(/\s+/).filter(p => p);
        if (!parts.length) return;

        const clean = t => t.replace(/^[[\(]+|[\]\)\,;]+$/g, '');
        const isWeightHash = t => /^\d+(?:\.\d+)?#$/.test(t);
        const isWeightXReps = t => /^(\d+(?:\.\d+)?)x(\d+(?:-\d+)?\+*)$/i.test(t);
        const isRepsOnly = t => /^\d+(?:-\d+)?\+*$/.test(t);

        let idx = parts.findIndex(p => {
            const t = clean(p);
            return isWeightHash(t) || isWeightXReps(t) || isRepsOnly(t);
        });

        let name = '';
        let setTokens = [];
        if (idx === -1) {
            name = parts.join(' ');
            setTokens = [];
        } else {
            name = parts.slice(0, idx).join(' ');
            setTokens = parts.slice(idx).map(clean);
        }

        if (!name) name = parts[0];

        let sets = [];
        let persistentWeight = null;

        setTokens.forEach(token => {
            const t = token.trim();
            if (!t) return;
            if (isWeightHash(t)) { persistentWeight = t.replace('#', ''); return; }
            if (isWeightXReps(t)) {
                const m = t.match(/^(\d+(?:\.\d+)?)x(\d+(?:-\d+)?\+*)$/i);
                if (m) { const repsRaw = m[2].replace(/\++$/g, ''); sets.push({ weight: m[1], reps: repsRaw }); }
                return;
            }
            if (isRepsOnly(t)) { const repsVal = t.replace(/\++$/g, ''); sets.push({ weight: persistentWeight ?? '', reps: repsVal }); return; }
            const fallbackX = t.match(/^(\d+(?:\.\d+)?)x(\d+(?:-\d+)?\+*)$/i);
            if (fallbackX) { sets.push({ weight: fallbackX[1], reps: fallbackX[2].replace(/\++$/g, '') }); return; }
        });

        createExerciseBlock(name, "", sets, true);
        lastCreated = document.querySelector('.exercise-block:last-of-type');
    });

    closeImportModal();
    saveData();
}

/* ---------------- EXPORT FUNCTION ---------------- */
function generateExportText() {
    const exercises = [...document.querySelectorAll(".exercise-block")];
    let lines = [];
    exercises.forEach(ex => {
        const name = ex.getAttribute("data-exercise");
        const sets = [...ex.querySelectorAll(".set-row")]
            .filter(r => r.querySelector(".reps").value.trim() !== "")
            .map(r => {
                const w = r.querySelector(".weight").value.trim();
                const rep = r.querySelector(".reps").value.trim();
                return w ? `${w}x${rep}` : `${rep}`;
            }).join(" ");
        lines.push(`${name} ${sets}`.trim());
        const comment = ex.querySelector(".comment").value.trim();
        if (comment) lines.push(`;${comment}`);
    });
    return lines.join("\n");
}

/* ---------------- POUCHDB HISTORY / EDIT ---------------- */
function initPouch() {
    try {
        if (!window.PouchDB) return false;
        if (!pouchDB) pouchDB = new PouchDB('workouts');
        return true;
    } catch (e) { console.error('Pouch init error', e); return false; }
}

function saveWorkout() {
    const exercises = [...document.querySelectorAll('.exercise-block')].map(ex => ({
        name: ex.getAttribute('data-exercise'),
        comment: ex.querySelector('.comment').value || '',
        sets: [...ex.querySelectorAll('.set-row')].map(r => ({ weight: r.querySelector('.weight').value, reps: r.querySelector('.reps').value }))
    }));
    if (!exercises.length) { alert('No exercises to save'); return; }
    const timestamp = Date.now();
    const summary = generateExportText();
    const doc = { _id: 'w:' + timestamp + ':' + Math.random().toString(36).slice(2,8), timestamp, summary, exercises };

    if (initPouch()) {
        pouchDB.put(doc).then(() => { alert('Workout saved locally (PouchDB)'); }).catch(err => { console.error('pouch put err', err); alert('Failed to save to local DB: ' + err.message); });
    } else {
        try {
            const arr = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
            arr.unshift(doc);
            localStorage.setItem('workoutHistory', JSON.stringify(arr.slice(0,200)));
            alert('Workout saved locally (localStorage)');
        } catch (e) { alert('Save failed'); }
    }
}

function openHistory() { document.getElementById('historyPage').style.display = 'flex'; loadHistory(); }
function closeHistory() { document.getElementById('historyPage').style.display = 'none'; }

function loadHistory() {
    historyDocs = [];
    historyIndex = 0;
    if (initPouch()) {
        pouchDB.allDocs({ include_docs: true, descending: true }).then(res => {
            historyDocs = res.rows.map(r => r.doc).sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
            renderHistory();
        }).catch(err => { console.error('pouch allDocs err', err); loadLocalHistoryFallback(); });
    } else {
        loadLocalHistoryFallback();
    }
}

function loadLocalHistoryFallback() { try { historyDocs = JSON.parse(localStorage.getItem('workoutHistory') || '[]'); } catch (e) { historyDocs = []; } renderHistory(); }

function renderHistory() {
    const slide = document.getElementById('historySlide');
    const counter = document.getElementById('historyCounter');
    if (!historyDocs || !historyDocs.length) { slide.textContent = 'No saved workouts'; counter.textContent = ''; return; }
    historyIndex = Math.min(Math.max(0, historyIndex), historyDocs.length - 1);
    const item = historyDocs[historyIndex];
    const date = new Date(item.timestamp || Date.now());

    let html = `<div style="display:flex; flex-direction:column; gap:12px;"><div style="font-size:12px; color:#bbb">${date.toLocaleString()}</div>`;
    if (item.exercises && item.exercises.length) {
        item.exercises.forEach(ex => {
            html += `<div style="padding:8px; background:#222; border-radius:6px;"><div style="font-weight:600; color:#f39c12; margin-bottom:6px;">${escapeHtml(ex.name)}</div>`;
            if (ex.sets && ex.sets.length) {
                html += '<div style="font-family:monospace; white-space:pre-wrap; color:#d4d4d4;">';
                ex.sets.forEach(s => {
                    const w = (s.weight || '').toString().trim();
                    const r = (s.reps || '').toString().trim();
                    if (w) html += `[${escapeHtml(w)}] x [${escapeHtml(r)}]\n`;
                    else html += `[${escapeHtml(r)}]\n`;
                });
                html += '</div>';
            }
            if (ex.comment) html += `<div style="margin-top:6px; color:#bbb; font-size:13px">${escapeHtml(ex.comment)}</div>`;
            html += '</div>';
        });
    } else {
        html += `<pre style="white-space:pre-wrap; font-family:monospace; font-size:13px; color:#d4d4d4">${escapeHtml(item.summary || '')}</pre>`;
    }
    html += '</div>';
    slide.innerHTML = html;
    counter.textContent = `${historyIndex+1} / ${historyDocs.length}`;
}

function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function historyNext() { if (historyIndex < historyDocs.length - 1) { historyIndex++; renderHistory(); } }
function historyPrev() { if (historyIndex > 0) { historyIndex--; renderHistory(); } }

function editCurrentWorkout() {
    if (!historyDocs || !historyDocs.length) return;
    const item = historyDocs[historyIndex];
    if (!item) return;
    document.getElementById('logContainer').innerHTML = '';
    item.exercises.forEach(ex => createExerciseBlock(ex.name, ex.comment || '', ex.sets || [], false));
    closeHistory();
}

/* ---------------- DRAG & DROP ---------------- */
function addDragAndDrop(block) {
    block.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", null); block.classList.add("dragging"); });
    block.addEventListener("dragend", () => { block.classList.remove("dragging"); saveData(); });
}
const container = document.getElementById("logContainer");
container.addEventListener("dragover", e => {
    e.preventDefault();
    const dragging = document.querySelector(".dragging");
    const afterElement = getDragAfterElement(container, e.clientY);
    if (!afterElement) container.appendChild(dragging);
    else container.insertBefore(dragging, afterElement);
});
function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll(".exercise-block:not(.dragging)")];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/* ---------------- SAVE / LOAD ---------------- */
function saveData() {
    const exercises = [...document.querySelectorAll(".exercise-block")];
    const data = exercises.map(ex => ({
        name: ex.getAttribute("data-exercise"),
        comment: ex.querySelector(".comment").value,
        sets: [...ex.querySelectorAll(".set-row")].map(r => ({ weight: r.querySelector(".weight").value, reps: r.querySelector(".reps").value }))
    }));
    localStorage.setItem("workoutLog", JSON.stringify(data));
}
function loadData() {
    const saved = JSON.parse(localStorage.getItem("workoutLog") || "[]");
    saved.forEach(ex => createExerciseBlock(ex.name, ex.comment, ex.sets));
}

// Helper modal open/close wrappers kept for compatibility
function openAddExerciseModal() { document.getElementById("addExerciseModalBg").style.display = "flex"; }
function closeAddExerciseModal() { document.getElementById("addExerciseModalBg").style.display = "none"; }
function openImportModal() { document.getElementById("importModalBg").style.display = "flex"; }
function closeImportModal() { document.getElementById("importModalBg").style.display = "none"; document.getElementById("importText").value = ""; }
function openExportModal() { document.getElementById("exportText").value = generateExportText(); document.getElementById("exportModalBg").style.display = "flex"; }
function closeExportModal() { document.getElementById("exportModalBg").style.display = "none"; }
function copyExport() { const textarea = document.getElementById("exportText"); textarea.select(); document.execCommand("copy"); alert("Copied to clipboard!"); }

// initialize: bind UI and load saved data once DOM is ready
function bindUI() {
    const actionMap = {
        startCountdown: (el) => {
            const s = el.getAttribute('data-seconds');
            const seconds = s ? parseInt(s, 10) : NaN;
            el.addEventListener('click', () => startCountdown(isNaN(seconds) ? undefined : seconds));
        },
        openAddExerciseModal: (el) => el.addEventListener('click', openAddExerciseModal),
        openImportModal: (el) => el.addEventListener('click', openImportModal),
        openExportModal: (el) => el.addEventListener('click', openExportModal),
        saveWorkout: (el) => el.addEventListener('click', saveWorkout),
        openHistory: (el) => el.addEventListener('click', openHistory),
        addExercise: (el) => el.addEventListener('click', () => addExercise()),
        closeAddExerciseModal: (el) => el.addEventListener('click', closeAddExerciseModal),
        importExercises: (el) => el.addEventListener('click', importExercises),
        closeImportModal: (el) => el.addEventListener('click', closeImportModal),
        copyExport: (el) => el.addEventListener('click', copyExport),
        closeExportModal: (el) => el.addEventListener('click', closeExportModal),
        editCurrentWorkout: (el) => el.addEventListener('click', editCurrentWorkout),
        closeHistory: (el) => el.addEventListener('click', closeHistory),
        historyNext: (el) => el.addEventListener('click', historyNext),
        historyPrev: (el) => el.addEventListener('click', historyPrev),
    };

    document.querySelectorAll('[data-action]').forEach(el => {
        const action = el.getAttribute('data-action');
        if (actionMap[action]) actionMap[action](el);
        else {
            // fallback to global function if still present
            const fn = window[action];
            if (typeof fn === 'function') el.addEventListener('click', () => fn());
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindUI();
    loadData();
});
