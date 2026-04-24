const STORAGE_KEY = "examflow-state-v6";
const TIMER_DURATION = 25 * 60;

const featureCards = [
  ["countdown.html", "Exam countdown", "A dramatic live counter with progress rings and instant updates."],
  ["planner.html", "Plan builder", "Priority scoring, table views, and backward planning in one place."],
  ["revisions.html", "Revision engine", "Rev-1, Rev-2, Rev-3 scheduling with spaced repetition."],
  ["recovery.html", "Recovery mode", "Missed-day rebalance with auto-inserted catch-up blocks."],
  ["focus.html", "Focus mode", "Today-only task panel with checklist and timer."],
  ["rescheduler.html", "What-if tool", "Change dates or hours and regenerate the schedule."],
  ["export.html", "Export", "Download the timetable as CSV or print a polished PDF."],
];

const state = normalizeState(loadState());

state.examDate = parseStoredDate(state.examDate);
state.plan = [];
state.topics = [];
state.timerRunning = false;
state.timerHandle = null;

const page = document.body?.dataset.page || "home";

document.addEventListener("DOMContentLoaded", () => {
  refreshPlan();
  initShell();
  initPage(page);
});

function normalizeState(saved) {
  const fallback = {
    exams: [],
    activeExamId: null,
    examDate: toInputDate(addDays(startOfDay(new Date()), 30)),
    studyHours: 4.5,
    studyWindow: {
      dayStart: "06:00",
      dayEnd: "09:00",
      nightStart: "19:00",
      nightEnd: "22:00",
    },
    confidenceSensitivity: 2,
    syllabusCompletion: 0,
    dateShift: 0,
    recoveryMode: "balanced",
    taskStatuses: {},
    timerSeconds: TIMER_DURATION,
  };

  if (!saved) return fallback;

  const exams = Array.isArray(saved.exams) ? saved.exams : [];
  const normalized = {
    ...fallback,
    ...saved,
    exams: exams.map((exam, index) => ({
      id: exam.id || `exam-${index + 1}`,
      name: exam.name || `Exam ${index + 1}`,
      date: normalizeDateString(exam.date || addDays(startOfDay(new Date()), 30)),
      subjects: Array.isArray(exam.subjects)
        ? exam.subjects.map((subject, sIndex) => ({
            id: subject.id || `subject-${sIndex + 1}`,
            name: subject.name || `Subject ${sIndex + 1}`,
            totalChapters: clamp(subject.totalChapters ?? 1, 1, 1000),
            completedChapters: clamp(subject.completedChapters ?? 0, 0, 1000),
            strength: ["weak", "neutral", "strong"].includes(subject.strength) ? subject.strength : "neutral",
            confidence: clamp(subject.confidence ?? 3, 1, 5),
          }))
        : [],
    })),
  };

  normalized.activeExamId = normalized.activeExamId || normalized.exams[0]?.id || null;
  normalized.examDate = normalizeDateString(normalized.examDate);
  normalized.studyWindow = {
    ...fallback.studyWindow,
    ...(saved.studyWindow || {}),
  };
  normalized.studyWindow = normalizeStudyWindow(normalized.studyWindow);
  normalized.studyHours = computeStudyHoursFromWindow(normalized.studyWindow, normalized.studyHours);
  return normalized;
}

function initShell() {
  document.querySelectorAll(".reveal").forEach((el, index) => {
    el.style.animationDelay = `${index * 80}ms`;
  });

  const topNavLinks = document.querySelectorAll(".topnav a");
  topNavLinks.forEach((link) => {
    if (location.pathname.endsWith(link.getAttribute("href"))) {
      link.classList.add("pill", "active");
    }
  });
}

function initPage(name) {
  if (name === "home") initHomePage();
  if (name === "countdown") initCountdownPage();
  if (name === "planner") initPlannerPage();
  if (name === "revisions") initRevisionPage();
  if (name === "recovery") initRecoveryPage();
  if (name === "focus") initFocusPage();
  if (name === "rescheduler") initReschedulerPage();
  if (name === "export") initExportPage();
}

function initHomePage() {
  const examInput = byId("homeExamDate");
  const hoursInput = byId("homeStudyHours");
  const refreshButton = byId("homeRefresh");

  if (examInput) examInput.value = toInputDate(getPrimaryExamDate());
  if (hoursInput) hoursInput.value = String(state.studyHours);

  examInput?.addEventListener("change", () => updateExamDate(examInput.value, "home"));
  hoursInput?.addEventListener("input", () => updateStudyHours(hoursInput.value));
  refreshButton?.addEventListener("click", () => refreshPlan(true));

  renderHomeFeatureStrip();
  renderHomeSnapshot();
  renderHomeAllocationTable();
}

function initCountdownPage() {
  bindPlannerControls("countdown");
  const sandTimer = byId("sandTimer");
  const summary = byId("countdownSummary");
  const boxDays = byId("countBoxDays");
  const boxHours = byId("countBoxHours");
  const boxMinutes = byId("countBoxMinutes");
  const boxSeconds = byId("countBoxSeconds");
  const examSelect = byId("countdownExamSelect");
  const addExamButton = byId("countdownAddExam");
  const addExamName = byId("countdownExamName");
  const addExamDate = byId("countdownExamDateNew");
  if (addExamDate && !addExamDate.value) addExamDate.value = toInputDate(addDays(startOfDay(new Date()), 30));

  renderCountdownExamOptions();
  if (examSelect) examSelect.value = state.activeExamId || "";
  examSelect?.addEventListener("change", () => {
    state.activeExamId = examSelect.value || null;
    saveState();
    refreshPlan(true);
  });

  addExamButton?.addEventListener("click", () => {
    const name = String(addExamName?.value || "").trim();
    const date = String(addExamDate?.value || "").trim();
    if (!name || !date) return;
    addExam(name, date);
    addExamName.value = "";
    addExamDate.value = "";
    renderCountdownExamOptions();
    if (examSelect) examSelect.value = state.activeExamId || "";
    refreshPlan(true);
  });

  sandTimer?.addEventListener("click", () => {
    if (!state.exams.length) return;
    const currentIndex = state.exams.findIndex((exam) => exam.id === state.activeExamId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % state.exams.length : 0;
    state.activeExamId = state.exams[nextIndex].id;
    saveState();
    if (examSelect) examSelect.value = state.activeExamId;
    sandTimer.classList.remove("flip");
    void sandTimer.offsetWidth;
    sandTimer.classList.add("flip");
    refreshPlan(true);
  });

  const update = () => {
    const activeExam = getActiveExam();
    const primaryDate = activeExam ? parseStoredDate(activeExam.date) : getPrimaryExamDate();
    const remaining = getCountdown(primaryDate);
    setAnimatedCounter(boxDays, String(remaining.days));
    setAnimatedCounter(boxHours, String(remaining.hours).padStart(2, "0"));
    setAnimatedCounter(boxMinutes, String(remaining.minutes).padStart(2, "0"));
    setAnimatedCounter(boxSeconds, String(remaining.seconds).padStart(2, "0"));
    if (sandTimer) {
      sandTimer.style.setProperty("--sand-progress", String(remaining.progress));
      sandTimer.classList.remove("sand-tick");
      void sandTimer.offsetWidth;
      sandTimer.classList.add("sand-tick");
    }
    if (summary) {
      const activeLabel = activeExam ? activeExam.name : "No exam";
      summary.textContent = `${activeLabel} • ${remaining.days}d ${remaining.hours}h ${remaining.minutes}m ${remaining.seconds}s • ${state.exams.length} exams total`;
    }
    renderCountdownList();
  };

  update();
  window.setInterval(update, 1000);
  renderCountdownHelpers("countdownPreview", "Countdown");
}

function initPlannerPage() {
  bindPlannerControls("planner");
  bindPlannerForms();
  renderPlannerExamOptions();
  renderPlannerTable();
  renderPlannerStats();
  renderPlannerCalendar();
  renderPlannerRecommendations();
}

function bindPlannerForms() {
  byId("plannerAddExam")?.addEventListener("click", () => {
    const name = String(byId("plannerExamName")?.value || "").trim();
    const date = String(byId("plannerExamDateNew")?.value || "").trim();
    if (!name || !date) return;
    addExam(name, date);
    if (byId("plannerExamName")) byId("plannerExamName").value = "";
    if (byId("plannerExamDateNew")) byId("plannerExamDateNew").value = "";
    renderPlannerExamOptions();
    refreshPlan(true);
  });

  byId("plannerExamSelect")?.addEventListener("change", (event) => {
    state.activeExamId = event.target.value || null;
    const activeExam = getActiveExam();
    if (activeExam) state.examDate = parseStoredDate(activeExam.date);
    saveState();
    refreshPlan(true);
  });

  byId("plannerAddSubject")?.addEventListener("click", () => {
    const exam = getActiveExam();
    if (!exam) return;
    const subjectName = String(byId("plannerSubjectName")?.value || "").trim();
    const total = Number(byId("plannerTotalChapters")?.value || 0);
    const completed = Number(byId("plannerCompletedChapters")?.value || 0);
    const strength = String(byId("plannerStrength")?.value || "neutral");
    const confidence = Number(byId("plannerSubjectConfidence")?.value || 3);
    if (!subjectName || total < 1) return;

    exam.subjects.push({
      id: `subject-${Date.now()}`,
      name: subjectName,
      totalChapters: clamp(total, 1, 1000),
      completedChapters: clamp(completed, 0, total),
      strength: ["weak", "neutral", "strong"].includes(strength) ? strength : "neutral",
      confidence: clamp(confidence, 1, 5),
    });

    ["plannerSubjectName", "plannerTotalChapters", "plannerCompletedChapters"].forEach((id) => {
      const el = byId(id);
      if (el) el.value = "";
    });
    if (byId("plannerStrength")) byId("plannerStrength").value = "weak";
    if (byId("plannerSubjectConfidence")) byId("plannerSubjectConfidence").value = "3";

    saveState();
    refreshPlan(true);
  });
}

function initRevisionPage() {
  bindPlannerControls("revisions");
  renderRevisionPage();
}

function initRecoveryPage() {
  bindPlannerControls("recovery");
  renderRecoveryPage();
}

function initFocusPage() {
  bindPlannerControls("focus");
  renderFocusPage();
  bindTimer();
}

function initReschedulerPage() {
  bindPlannerControls("rescheduler");
  renderReschedulerPage();
}

function initExportPage() {
  bindPlannerControls("export");
  renderExportPage();
}

function bindPlannerControls(prefix) {
  const examInput = byId(`${prefix}ExamDate`);
  const hoursInput = byId(`${prefix}StudyHours`);
  const confidenceInput = byId(`${prefix}Confidence`);
  const completionInput = byId(`${prefix}SyllabusCompletion`);
  const shiftInput = byId(`${prefix}DateShift`);
  const modeInput = byId(`${prefix}RecoveryMode`);
  const regenButton = byId(`${prefix}Refresh`);
  const dayStartInput = byId(`${prefix}DayStart`);
  const dayEndInput = byId(`${prefix}DayEnd`);
  const nightStartInput = byId(`${prefix}NightStart`);
  const nightEndInput = byId(`${prefix}NightEnd`);

  if (examInput) examInput.value = toInputDate(getPrimaryExamDate());
  if (hoursInput) hoursInput.value = String(state.studyHours);
  if (confidenceInput) confidenceInput.value = String(state.confidenceSensitivity);
  if (completionInput) completionInput.value = String(state.syllabusCompletion);
  if (shiftInput) shiftInput.value = String(state.dateShift);
  if (modeInput) modeInput.value = state.recoveryMode;
  if (dayStartInput) dayStartInput.value = state.studyWindow.dayStart;
  if (dayEndInput) dayEndInput.value = state.studyWindow.dayEnd;
  if (nightStartInput) nightStartInput.value = state.studyWindow.nightStart;
  if (nightEndInput) nightEndInput.value = state.studyWindow.nightEnd;

  examInput?.addEventListener("change", () => updateExamDate(examInput.value, prefix));
  hoursInput?.addEventListener("input", () => updateStudyHours(hoursInput.value));
  confidenceInput?.addEventListener("input", () => {
    state.confidenceSensitivity = Number(confidenceInput.value);
    saveState();
    refreshPlan(true);
  });
  completionInput?.addEventListener("input", () => {
    state.syllabusCompletion = Number(completionInput.value);
    saveState();
    refreshPlan(true);
  });
  shiftInput?.addEventListener("input", () => {
    state.dateShift = Number(shiftInput.value);
    saveState();
    refreshPlan(true);
  });
  modeInput?.addEventListener("change", () => {
    state.recoveryMode = modeInput.value;
    saveState();
    refreshPlan(true);
  });
  dayStartInput?.addEventListener("change", () => updateStudyWindow({ dayStart: dayStartInput.value }));
  dayEndInput?.addEventListener("change", () => updateStudyWindow({ dayEnd: dayEndInput.value }));
  nightStartInput?.addEventListener("change", () => updateStudyWindow({ nightStart: nightStartInput.value }));
  nightEndInput?.addEventListener("change", () => updateStudyWindow({ nightEnd: nightEndInput.value }));
  regenButton?.addEventListener("click", () => refreshPlan(true));
}

function bindTimer() {
  byId("focusStart")?.addEventListener("click", startTimer);
  byId("focusPause")?.addEventListener("click", pauseTimer);
  byId("focusReset")?.addEventListener("click", resetTimer);
  updateTimerDisplay();
}

function updateExamDate(value, source = "") {
  if (!value) return;
  const activeExam = getActiveExam();
  if (activeExam) {
    activeExam.date = normalizeDateString(value);
    state.examDate = parseStoredDate(activeExam.date);
  } else {
    state.examDate = parseStoredDate(value);
  }
  saveState();
  refreshPlan(true);
  if (source === "home") {
    renderHomeSnapshot();
    renderHomeAllocationTable();
  }
}

function updateStudyHours(value) {
  state.studyHours = Number(value);
  saveState();
  refreshPlan(true);
}

function updateStudyWindow(patch) {
  state.studyWindow = normalizeStudyWindow({
    ...state.studyWindow,
    ...patch,
  });
  state.studyHours = computeStudyHoursFromWindow(state.studyWindow, state.studyHours);
  const hoursLabel = byId("plannerWindowHours");
  if (hoursLabel) hoursLabel.textContent = `${state.studyHours.toFixed(1)}h/day`;
  const slider = byId("plannerStudyHours");
  if (slider) slider.value = String(state.studyHours);
  saveState();
  refreshPlan(true);
}

function addExam(name, date) {
  const exam = {
    id: `exam-${Date.now()}`,
    name,
    date: normalizeDateString(date),
    subjects: [],
  };
  state.exams.push(exam);
  state.activeExamId = exam.id;
  state.examDate = parseStoredDate(exam.date);
  saveState();
}

function getActiveExam() {
  if (!state.exams.length) return null;
  const active = state.exams.find((exam) => exam.id === state.activeExamId);
  return active || state.exams[0];
}

function getPrimaryExamDate() {
  const now = new Date();
  const upcoming = [...state.exams]
    .map((exam) => ({ ...exam, dateObj: parseStoredDate(exam.date) }))
    .filter((exam) => exam.dateObj >= startOfDay(now))
    .sort((a, b) => a.dateObj - b.dateObj);
  if (upcoming.length) return upcoming[0].dateObj;
  const active = getActiveExam();
  return active ? parseStoredDate(active.date) : state.examDate;
}

function renderPlannerExamOptions() {
  const select = byId("plannerExamSelect");
  if (!select) return;
  if (!state.exams.length) {
    select.innerHTML = `<option value="">No exams yet</option>`;
    return;
  }
  select.innerHTML = state.exams
    .map((exam) => `<option value="${escapeHtml(exam.id)}">${escapeHtml(exam.name)} • ${formatShortDate(parseStoredDate(exam.date))}</option>`)
    .join("");
  select.value = state.activeExamId || state.exams[0].id;
  const hoursLabel = byId("plannerWindowHours");
  if (hoursLabel) hoursLabel.textContent = `${state.studyHours.toFixed(1)}h/day`;
}

function renderCountdownExamOptions() {
  const select = byId("countdownExamSelect");
  if (!select) return;
  if (!state.exams.length) {
    select.innerHTML = `<option value="">No exams yet</option>`;
    return;
  }
  select.innerHTML = state.exams
    .map((exam) => `<option value="${escapeHtml(exam.id)}">${escapeHtml(exam.name)} • ${formatShortDate(parseStoredDate(exam.date))}</option>`)
    .join("");
  select.value = state.activeExamId || state.exams[0].id;
}

function refreshPlan(render = false) {
  const activeExam = getActiveExam();
  state.topics = activeExam
    ? activeExam.subjects.map((subject, index) => ({
        id: subject.id || `topic-${index + 1}`,
        name: subject.name,
        difficulty: subject.strength === "weak" ? 5 : subject.strength === "neutral" ? 3 : 2,
        weightage: clamp(subject.totalChapters - subject.completedChapters, 1, 5),
        timePressure: 3,
        confidence: clamp(subject.confidence, 1, 5),
      }))
    : [];
  state.plan = buildPlan();
  saveState();
  if (render) {
    renderHomeSnapshot();
    renderHomeAllocationTable();
    renderPlannerTable();
    renderPlannerStats();
    renderPlannerCalendar();
    renderPlannerRecommendations();
    renderPlannerExamOptions();
    renderRevisionPage();
    renderRecoveryPage();
    renderFocusPage();
    renderReschedulerPage();
    renderExportPage();
  }
}

function buildPlan() {
  if (!state.exams.length) return [];

  const now = startOfDay(new Date());
  const allTasks = state.exams.flatMap((exam) => buildPlanForExam(exam, now));

  return allTasks
    .filter((task) => task.date >= now)
    .sort((a, b) => a.date - b.date || b.priority - a.priority || a.topic.localeCompare(b.topic));
}

function buildPlanForExam(exam, now) {
  const examDate = addDays(startOfDay(parseStoredDate(exam.date)), state.dateShift);
  const daysLeft = Math.max(1, diffDays(now, examDate));
  const revisionOffsets = [2, 5];
  const recoverySpacing = state.recoveryMode === "aggressive" ? 1 : state.recoveryMode === "light" ? 4 : 2;
  const subjects = Array.isArray(exam.subjects) ? exam.subjects : [];
  if (!subjects.length) return [];

  const weightedSubjects = subjects
    .map((subject) => {
      const remaining = Math.max(0, subject.totalChapters - subject.completedChapters);
      const strengthFactor = subject.strength === "weak" ? 1.45 : subject.strength === "neutral" ? 1.0 : 0.72;
      const confidenceGap = 6 - clamp(subject.confidence, 1, 5);
      const weight = Math.max(0.1, remaining * strengthFactor * (1 + confidenceGap * 0.16));
      return { ...subject, remaining, strengthFactor, confidenceGap, weight };
    })
    .filter((subject) => subject.remaining > 0)
    .sort((a, b) => b.weight - a.weight);

  if (!weightedSubjects.length) {
    return [
      createTask(`${exam.name}`, "Revision Window", addDays(examDate, -2), 55, 3, Math.max(1, state.studyHours * 0.6), "All chapters completed. Use this for final revision.", { name: exam.name }),
    ];
  }

  const chapterQueue = [];
  weightedSubjects.forEach((subject) => {
    for (let chapter = subject.completedChapters + 1; chapter <= subject.totalChapters; chapter += 1) {
      chapterQueue.push({
        subject,
        chapter,
      });
    }
  });

  chapterQueue.sort((a, b) => b.subject.weight - a.subject.weight || a.chapter - b.chapter);

  const tasks = [];
  const sessions = getStudySessions(state.studyWindow);
  const dailyCapacity = Math.max(1, sessions.length);
  chapterQueue.forEach((item, index) => {
    const dayOffset = Math.floor(index / dailyCapacity);
    const session = sessions[index % sessions.length];
    const studyDate = addDays(now, Math.min(dayOffset, Math.max(0, daysLeft - 1)));
    const basePriority = Math.min(100, 35 + item.subject.weight * 12 + (6 - item.subject.confidence) * 6);
    const topicName = `${item.subject.name}`;
    const chapterLabel = `Chapter ${item.chapter}/${item.subject.totalChapters}`;
    const allocationLabel = formatAllocation(session);
    const note = `${exam.name} • ${chapterLabel} • ${allocationLabel}`;

    tasks.push(
      createTask(
        topicName,
        "Chapter Study",
        studyDate,
        basePriority,
        item.subject.confidence,
        session.durationHours,
        note,
        item.subject,
        false,
        {
          chapterLabel,
          allocation: allocationLabel,
          sessionLabel: session.label,
        }
      )
    );

    revisionOffsets.forEach((offset, revIndex) => {
      const revDate = addDays(studyDate, offset);
      if (revDate < examDate) {
        tasks.push(
          createTask(
            topicName,
            `Rev-${revIndex + 1}`,
            revDate,
            Math.max(25, basePriority - (revIndex + 1) * 8),
            Math.min(5, item.subject.confidence + revIndex * 0.4),
            Math.max(0.5, session.durationHours * (revIndex === 0 ? 0.6 : 0.5)),
            `${exam.name} • ${chapterLabel} revision • ${allocationLabel}`,
            item.subject,
            false,
            {
              chapterLabel,
              allocation: allocationLabel,
              sessionLabel: session.label,
            }
          )
        );
      }
    });
  });

  weightedSubjects.forEach((subject, index) => {
    const finalRevDate = addDays(examDate, -(2 + Math.min(index, 2)));
    if (finalRevDate >= now) {
      tasks.push(
        createTask(
          `${subject.name} • Final revision`,
          "Revision Window",
          finalRevDate,
          Math.min(95, 60 + subject.weight * 10),
          subject.confidence,
          Math.max(1, roundTo(state.studyHours * 0.6, 0.25)),
          `${exam.name} final stretch`,
          subject
        )
      );
    }
  });

  const missed = tasks.filter((task) => state.taskStatuses[task.id] === "missed");
  missed.forEach((task, index) => {
    const recoveryDate = addDays(task.date, Math.min(index + recoverySpacing, 6 + recoverySpacing));
    if (recoveryDate < examDate) {
      tasks.push({
        ...task,
        id: `${task.id}-recovery`,
        type: "Recovery",
        date: recoveryDate,
        priority: Math.min(100, task.priority + 10),
        recovery: true,
        note: `${exam.name} auto recovery`,
      });
    }
  });

  return tasks
    .filter((task) => task.date <= examDate)
    .map((task) => ({
      ...task,
      examId: exam.id,
      examName: exam.name,
    }));
}

function generateBufferDays(today, exam, tasks) {
  const byDate = new Map();
  tasks.forEach((task) => {
    const key = toInputDate(task.date);
    byDate.set(key, true);
  });

  const buffers = [];
  for (let cursor = startOfDay(today); cursor <= exam; cursor = addDays(cursor, 1)) {
    const key = toInputDate(cursor);
    if (!byDate.has(key)) {
      buffers.push({
        id: `buffer-${key}`,
        topic: "Buffer / catch-up",
        type: "Recovery",
        date: new Date(cursor),
        priority: 35,
        confidence: 3,
        duration: 1,
        note: "Use for backlog or gentle review",
        buffer: true,
      });
    }
  }
  return buffers;
}

function createTask(topic, type, date, priority, confidence, duration, note, sourceTopic, mock = false, extra = {}) {
  return {
    id: `${slugify(topic)}-${type.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${toInputDate(date)}`,
    topic,
    type,
    date: startOfDay(date),
    priority: roundTo(priority, 1),
    confidence: roundTo(confidence, 0.1),
    duration: roundTo(duration, 0.25),
    note,
    sourceTopic,
    mock,
    ...extra,
  };
}

function priorityScore(topic, daysLeft) {
  const urgency = 1 + Math.max(0, 20 - daysLeft) / 18;
  const confidenceGap = 6 - topic.confidence;
  const completionBias = 1 + (100 - state.syllabusCompletion) / 250;
  const sensitivity = 1 + state.confidenceSensitivity * 0.07;
  return (topic.difficulty * 18 + topic.weightage * 16 + topic.timePressure * 12 + confidenceGap * 14) * urgency * completionBias * sensitivity;
}

function renderHomeFeatureStrip() {
  const grid = byId("featureGrid");
  if (!grid) return;
  grid.innerHTML = featureCards
    .map(
      ([href, title, desc], index) => `
        <a class="feature-card reveal" href="${href}" style="animation-delay:${index * 60}ms">
          <div class="feature-head">
            <strong>${escapeHtml(title)}</strong>
            <span class="round-badge">0${index + 1}</span>
          </div>
          <span>${escapeHtml(desc)}</span>
          <div class="loader-line"></div>
        </a>`
    )
    .join("");
}

function renderHomeSnapshot() {
  const target = byId("homeSnapshot");
  const days = getCountdown(getPrimaryExamDate());
  const weakTopics = state.exams.flatMap((exam) => exam.subjects || []).filter((subject) => subject.confidence <= 3).length;
  const mocks = state.plan.filter((task) => task.mock).length;
  const nextTask = state.plan.find((task) => task.date >= startOfDay(new Date()));
  const progress = days.total ? Math.round(((days.total - days.days) / days.total) * 100) : 0;
  const daysLeft = byId("homeDaysLeft");
  if (daysLeft) daysLeft.textContent = String(days.days);
  const ring = document.querySelector(".countdown-ring");
  if (ring) ring.style.setProperty("--progress", String(progress));
  if (!target) return;
  target.innerHTML = [
    miniCard(progress, "countdown progress"),
    miniCard(weakTopics, "weak topics"),
    miniCard(state.exams.length, "exams"),
    miniCard(nextTask ? nextTask.topic : "Ready", "next block"),
  ].join("");
}

function renderHomeAllocationTable() {
  const target = byId("homeAllocationBody");
  if (!target) return;
  const activeExam = getActiveExam();
  const rows = getPlanForActiveExam()
    .filter((task) => task.type === "Chapter Study" || /^Rev-/.test(task.type) || task.type === "Revision Window")
    .slice(0, 12)
    .map((task) => {
      const chapter = task.chapterLabel || (task.type === "Revision Window" ? "Final revision" : "-");
      const allocation = task.allocation || extractAllocationFromNote(task.note) || "Auto";
      return `
        <tr>
          <td>${formatDate(task.date)}</td>
          <td>${escapeHtml(task.topic)}</td>
          <td>${escapeHtml(chapter)}</td>
          <td>${escapeHtml(allocation)}</td>
          <td>${escapeHtml(task.type)}</td>
        </tr>`;
    })
    .join("");

  if (!rows) {
    target.innerHTML = `<tr><td colspan="5" class="muted">No allocation yet. Add subjects in planner to auto-assign chapters and time blocks.</td></tr>`;
    return;
  }

  target.innerHTML = rows;
}

function renderPlannerStats() {
  const target = byId("plannerStats");
  if (!target) return;
  const activeExam = getActiveExam();
  const visiblePlan = getPlanForActiveExam();
  const days = getCountdown(activeExam ? parseStoredDate(activeExam.date) : getPrimaryExamDate());
  const avg = Math.round(visiblePlan.reduce((sum, task) => sum + task.priority, 0) / Math.max(1, visiblePlan.length));
  const lowConfidence = (activeExam?.subjects || []).filter((subject) => subject.confidence <= 3).length;
  const completed = Object.values(state.taskStatuses).filter((value) => value === "done").length;
  target.innerHTML = [
    metricCard(days.days, "days left"),
    metricCard(avg, "avg priority"),
    metricCard(lowConfidence, "weak topics"),
    metricCard(completed, "completed blocks"),
  ].join("");
  const summary = byId("plannerSummary");
  if (summary) summary.textContent = `${visiblePlan.length} blocks generated`;
}

function renderPlannerTable() {
  const target = byId("plannerTable");
  if (!target) return;
  const visiblePlan = getPlanForActiveExam();
  if (!visiblePlan.length) {
    target.innerHTML = `<tr><td colspan="6" class="muted">No plan yet. Add subjects and chapter progress to generate tasks.</td></tr>`;
    return;
  }

  const rows = visiblePlan.slice(0, 40).map((task) => {
    const status = state.taskStatuses[task.id] || (task.recovery ? "recovered" : "ready");
    return `
      <tr>
        <td>${formatDate(task.date)}</td>
        <td>
          <div class="task-pill ${pillClass(task)}">${escapeHtml(task.topic)}</div>
          <div class="hint">${escapeHtml(task.note || "")}</div>
        </td>
        <td>${escapeHtml(task.type)}</td>
        <td><span class="priority-pill">${Math.round(task.priority)}</span></td>
        <td>${task.confidence.toFixed(1)} / 5</td>
        <td><span class="status-pill">${escapeHtml(status)}</span></td>
      </tr>`;
  }).join("");
  target.innerHTML = rows;
}

function renderPlannerCalendar() {
  const target = byId("plannerCalendar");
  if (!target) return;

  const activeExam = getActiveExam();
  const visiblePlan = getPlanForActiveExam();

  if (!activeExam || !(activeExam.subjects || []).length) {
    target.innerHTML = `<div class="summary-card"><strong>No subjects yet</strong><p>Add subjects and chapter progress to populate this weekly panel.</p></div>`;
    return;
  }

  const week = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(new Date()), index));
  target.innerHTML = week.map((date) => {
    const items = visiblePlan.filter((task) => isSameDay(task.date, date)).slice(0, 3);
    return `
      <div class="heat-cell">
        <strong>${weekdayName(date)}</strong>
        <small>${formatDate(date)} • ${items.length} blocks</small>
        ${items.length
          ? `<div class="hint">${escapeHtml(items[0].chapterLabel || items[0].type)} • ${escapeHtml(items[0].allocation || "Auto")}</div>`
          : `<div class="hint">No blocks</div>`}
      </div>`;
  }).join("");
}

function getPlanForActiveExam() {
  const activeExam = getActiveExam();
  if (!activeExam) return [];
  return state.plan.filter((task) => task.examId === activeExam.id);
}

function renderPlannerRecommendations() {
  const target = byId("plannerRecommendations");
  if (!target) return;
  const activeExam = getActiveExam();
  const subjects = activeExam?.subjects || [];
  if (!subjects.length) {
    target.innerHTML = `<div class="summary-card"><strong>Personal recommendations</strong><p>Add subjects to get customized study suggestions.</p></div>`;
    return;
  }

  const weakest = [...subjects].sort((a, b) => (a.confidence + (a.strength === "weak" ? 0 : 2)) - (b.confidence + (b.strength === "weak" ? 0 : 2)))[0];
  const highestBacklog = [...subjects].sort((a, b) => (b.totalChapters - b.completedChapters) - (a.totalChapters - a.completedChapters))[0];
  const completionRate = Math.round(
    (subjects.reduce((sum, subject) => sum + subject.completedChapters, 0) /
      Math.max(1, subjects.reduce((sum, subject) => sum + subject.totalChapters, 0))) *
      100
  );

  target.innerHTML = [
    summaryCard("Focus subject", weakest?.name || "-", `Use active recall + 2 short revisions weekly.`),
    summaryCard("Backlog to clear", highestBacklog?.name || "-", `Complete 1 chapter/day until backlog drops.`),
    summaryCard("Progress", `${completionRate}%`, `Target 70% before final revision window.`),
    summaryCard("Confidence tip", "After each chapter", `Rate confidence 1-5 and re-prioritize weak areas.`),
  ].join("");
}

function renderRevisionPage() {
  const timeline = byId("revisionTimeline");
  const cards = byId("revisionCards");
  if (timeline) {
    timeline.innerHTML = state.plan.filter((task) => /^Rev-/.test(task.type)).slice(0, 10).map((task) => timelineHTML(task)).join("");
  }
  if (cards) {
    cards.innerHTML = [
      summaryCard("Rev-1", "24 hours after first study", "Quick recall and mistake spotting."),
      summaryCard("Rev-2", "72 hours later", "Second pass with active recall prompts."),
      summaryCard("Rev-3", "7 days later", "Longer retention test with mini-quiz."),
    ].join("");
  }
  const stats = byId("revisionStats");
  if (stats) {
    const revCount = state.plan.filter((task) => /^Rev-/.test(task.type)).length;
    const mockCount = state.plan.filter((task) => task.mock).length;
    stats.innerHTML = [metricCard(revCount, "revision blocks"), metricCard(mockCount, "mock tests"), metricCard(state.topics.length, "topics")].join("");
  }
}

function renderRecoveryPage() {
  const target = byId("recoveryList");
  if (!target) return;
  const missed = state.plan.filter((task) => state.taskStatuses[task.id] === "missed");
  target.innerHTML = missed.length
    ? missed.map((task) => `
      <div class="task-card">
        <div class="task-head"><strong>${escapeHtml(task.topic)}</strong><span class="chip">missed</span></div>
        <p>${escapeHtml(task.note || "")}</p>
        <div class="action-row">
          <button data-recover="${task.id}">Insert recovery</button>
          <button data-reset="${task.id}">Reset</button>
        </div>
      </div>`).join("")
    : `<div class="summary-card"><strong>No missed tasks yet</strong><p>Mark a task as missed from Focus mode to see the recovery engine rebalance automatically.</p></div>`;

  target.querySelectorAll("[data-recover]").forEach((button) => button.addEventListener("click", () => {
    state.taskStatuses[button.dataset.recover] = "missed";
    saveState();
    refreshPlan(true);
  }));
  target.querySelectorAll("[data-reset]").forEach((button) => button.addEventListener("click", () => {
    delete state.taskStatuses[button.dataset.reset];
    saveState();
    refreshPlan(true);
  }));
}

function renderFocusPage() {
  const list = byId("focusTasks");
  const next = byId("focusNext");
  const mood = byId("focusMood");
  if (!list) return;
  const today = startOfDay(new Date());
  const tasks = state.plan.filter((task) => isSameDay(task.date, today)).slice(0, 5);
  list.innerHTML = tasks.length
    ? tasks.map((task) => `
      <li>
        <header>
          <strong>${escapeHtml(task.topic)}</strong>
          <span>${escapeHtml(task.type)}</span>
        </header>
        <p>${escapeHtml(task.note || "Focus block")}</p>
        <div class="task-actions">
          <button data-status="done" data-task="${task.id}">Done</button>
          <button data-status="missed" data-task="${task.id}">Missed</button>
          <button data-status="reset" data-task="${task.id}">Reset</button>
        </div>
      </li>`).join("")
    : `<li><strong>Buffer day</strong><p>Use this time to catch up or review weak topics.</p></li>`;
  if (next) next.textContent = tasks[0] ? tasks[0].topic : "Buffer / catch-up";
  if (mood) mood.textContent = `${tasks.length} tasks ready for today`;
  list.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.task;
    const status = button.dataset.status;
    if (status === "reset") delete state.taskStatuses[id];
    else state.taskStatuses[id] = status;
    saveState();
    refreshPlan(true);
  }));
}

function renderReschedulerPage() {
  const result = byId("whatIfResult");
  const table = byId("whatIfTable");
  if (result) {
    const days = getCountdown(getPrimaryExamDate());
    result.innerHTML = [
      summaryCard("Days left", String(days.days), "Based on the current exam date"),
      summaryCard("Available hours", `${state.studyHours.toFixed(1)}h`, "Per day planning capacity"),
      summaryCard("Confidence mode", confidenceLabel(state.confidenceSensitivity), "Topics with low confidence get boosted"),
    ].join("");
  }
  if (table) {
    table.innerHTML = state.plan.slice(0, 8).map((task) => `<div class="timeline-card"><strong>${escapeHtml(task.topic)}</strong><span>${formatDate(task.date)} • ${escapeHtml(task.type)}</span></div>`).join("");
  }
}

function renderExportPage() {
  const preview = byId("exportPreview");
  if (preview) {
    preview.innerHTML = state.plan.slice(0, 6).map((task) => timelineHTML(task)).join("");
  }
}

function renderCountdownHelpers(containerId, heading) {
  const container = byId(containerId);
  if (!container) return;
  const days = getCountdown(getPrimaryExamDate());
  container.innerHTML = [
    summaryCard(heading, `${days.days} days`, "A polished exam countdown"),
    summaryCard("Revision rhythm", "Rev-1 / Rev-2 / Rev-3", "Built from spaced repetition"),
    summaryCard("Recovery", `${Object.keys(state.taskStatuses).filter((key) => state.taskStatuses[key] === "missed").length} missed`, "Auto rebalance on the fly"),
  ].join("");
}

function renderCountdownList() {
  const list = byId("countdownList");
  if (!list) return;
  if (!state.exams.length) {
    list.innerHTML = `<div class="summary-card"><strong>No exams added</strong><p>Add your first exam from the right panel.</p></div>`;
    return;
  }

  list.innerHTML = state.exams
    .map((exam) => {
      const countdown = getCountdown(parseStoredDate(exam.date));
      return `
        <button class="timeline-card ${exam.id === state.activeExamId ? "active-countdown-card" : ""}" data-countdown-exam="${escapeHtml(exam.id)}" type="button">
          <strong>${escapeHtml(exam.name)}</strong>
          <span>${formatDate(parseStoredDate(exam.date))}</span>
          <p>${countdown.days}d ${String(countdown.hours).padStart(2, "0")}h ${String(countdown.minutes).padStart(2, "0")}m ${String(countdown.seconds).padStart(2, "0")}s</p>
        </button>`;
    })
    .join("");

  list.querySelectorAll("[data-countdown-exam]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeExamId = button.getAttribute("data-countdown-exam");
      saveState();
      renderCountdownExamOptions();
      refreshPlan(true);
    });
  });
}

function renderPlannerCalendarSummary(containerId) {
  const target = byId(containerId);
  if (!target) return;
  const week = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(new Date()), index));
  target.innerHTML = week.map((date) => {
    const tasks = state.plan.filter((task) => isSameDay(task.date, date));
    return `<div class="heat-cell"><strong>${weekdayName(date)}</strong><small>${tasks.length} blocks</small></div>`;
  }).join("");
}

function getCountdown(targetDate = getPrimaryExamDate()) {
  const now = new Date();
  const examBase = targetDate ? new Date(targetDate) : new Date();
  const examDay = addDays(startOfDay(examBase), state.dateShift);
  const examMoment = endOfDay(examDay);
  const remainingMs = Math.max(0, examMoment - now);

  const remainingTotalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(remainingTotalSeconds / 86400);
  const hours = Math.floor((remainingTotalSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingTotalSeconds % 3600) / 60);
  const seconds = remainingTotalSeconds % 60;

  const todayStart = startOfDay(now);
  const totalWindowSeconds = Math.max(1, Math.floor((examMoment - todayStart) / 1000));
  const progress = clamp(((totalWindowSeconds - remainingTotalSeconds) / totalWindowSeconds) * 100, 0, 100);

  return {
    total: Math.max(1, Math.ceil(totalWindowSeconds / 86400)),
    days,
    hours,
    minutes,
    seconds,
    progress,
  };
}

function setAnimatedCounter(element, nextValue) {
  if (!element) return;
  if (element.dataset.prev === String(nextValue)) return;
  element.dataset.prev = String(nextValue);
  element.textContent = String(nextValue);
  element.classList.remove("tick");
  void element.offsetWidth;
  element.classList.add("tick");
}

function exportCSV() {
  const rows = [
    ["Date", "Topic", "Type", "Priority", "Confidence", "Duration", "Status"],
    ...state.plan.map((task) => [
      formatDate(task.date),
      task.topic,
      task.type,
      Math.round(task.priority),
      task.confidence.toFixed(1),
      task.duration,
      state.taskStatuses[task.id] || (task.recovery ? "recovered" : "ready"),
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadFile(URL.createObjectURL(blob), "examflow-plan.csv");
}

function startTimer() {
  if (state.timerRunning) return;
  state.timerRunning = true;
  state.timerHandle = window.setInterval(() => {
    state.timerSeconds = Math.max(0, state.timerSeconds - 1);
    updateTimerDisplay();
    saveState();
    if (state.timerSeconds === 0) pauseTimer();
  }, 1000);
}

function pauseTimer() {
  state.timerRunning = false;
  if (state.timerHandle) window.clearInterval(state.timerHandle);
  state.timerHandle = null;
}

function resetTimer() {
  pauseTimer();
  state.timerSeconds = TIMER_DURATION;
  updateTimerDisplay();
  saveState();
}

function updateTimerDisplay() {
  const target = byId("focusTimer");
  if (!target) return;
  target.textContent = formatTimer(state.timerSeconds);
  const ring = document.querySelector(".timer-ring");
  if (ring) ring.style.setProperty("--timer-progress", String(((TIMER_DURATION - state.timerSeconds) / TIMER_DURATION) * 100));
}

function renderPageTimers() {
  updateTimerDisplay();
}

function bindCountdownAnimations() {
  const ring = document.querySelector(".countdown-ring");
  if (!ring) return;
  const setProgress = () => {
    const countdown = getCountdown();
    ring.style.setProperty("--progress", String(countdown.progress));
  };
  setProgress();
  window.setInterval(setProgress, 1000);
}

function miniCard(value, label) {
  return `<div class="mini-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function metricCard(value, label) {
  return `<div class="metric-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function summaryCard(title, value, note) {
  return `<div class="summary-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(value)}</span><p>${escapeHtml(note)}</p></div>`;
}

function timelineHTML(task) {
  return `<div class="timeline-card"><strong>${escapeHtml(task.topic)}</strong><span>${formatDate(task.date)} • ${escapeHtml(task.type)} • ${Math.round(task.priority)}</span><p>${escapeHtml(task.note || "")}</p></div>`;
}

function extractAllocationFromNote(note) {
  const text = String(note || "");
  const match = text.match(/(\d{2}:\d{2})\s+to\s+(\d{2}:\d{2})/i);
  return match ? `${match[1]} to ${match[2]}` : "";
}

function pillClass(task) {
  if (task.recovery) return "recovery";
  if (/rev/i.test(task.type)) return "revision";
  if (/mock/i.test(task.type)) return "mock";
  return "";
}

function bindHomeCountdown() {
  const ring = document.querySelector(".countdown-ring");
  if (!ring) return;
  const set = () => {
    const countdown = getCountdown();
    ring.style.setProperty("--progress", String(countdown.progress));
  };
  set();
  window.setInterval(set, 1000);
}

function confidenceLabel(value) {
  if (value <= 1) return "Low";
  if (value <= 2.5) return "Balanced";
  if (value <= 3.5) return "Strong";
  return "Aggressive";
}

function renderExportPreview() {
  renderExportPage();
}

function renderPlannerFullPreview() {
  renderPlannerStats();
  renderPlannerTable();
  renderPlannerCalendar();
}

function formatTimer(seconds) {
  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function handleTaskButtons(container) {
  container.querySelectorAll("[data-task]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.task;
      const status = button.dataset.status;
      if (status === "reset") delete state.taskStatuses[id];
      else state.taskStatuses[id] = status;
      saveState();
      refreshPlan(true);
    });
  });
}

function byId(id) {
  return document.getElementById(id);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState() {
  const payload = {
    exams: state.exams,
    activeExamId: state.activeExamId,
    examDate: normalizeDateString(state.examDate),
    studyHours: state.studyHours,
    studyWindow: normalizeStudyWindow(state.studyWindow),
    confidenceSensitivity: state.confidenceSensitivity,
    syllabusCompletion: state.syllabusCompletion,
    dateShift: state.dateShift,
    recoveryMode: state.recoveryMode,
    taskStatuses: state.taskStatuses,
    timerSeconds: state.timerSeconds,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function downloadFile(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function diffDays(start, end) {
  return Math.round((startOfDay(end) - startOfDay(start)) / 86400000);
}

function startOfWeek(date) {
  const d = startOfDay(date);
  return addDays(d, -d.getDay());
}

function isSameDay(a, b) {
  return toInputDate(a) === toInputDate(b);
}

function toInputDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    const yyyy = fallback.getFullYear();
    const mm = String(fallback.getMonth() + 1).padStart(2, "0");
    const dd = String(fallback.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function weekdayName(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

function parseTimeToMinutes(value, fallback) {
  const raw = String(value || fallback || "00:00");
  const [h = "0", m = "0"] = raw.split(":");
  return clamp(Number(h) * 60 + Number(m), 0, 1439);
}

function spanHours(startMinutes, endMinutes) {
  return endMinutes >= startMinutes
    ? (endMinutes - startMinutes) / 60
    : (24 * 60 - startMinutes + endMinutes) / 60;
}

function computeStudyHoursFromWindow(window, fallbackHours = 4.5) {
  if (!window) return fallbackHours;
  const dayStart = parseTimeToMinutes(window.dayStart, "06:00");
  const dayEnd = parseTimeToMinutes(window.dayEnd, "09:00");
  const nightStart = parseTimeToMinutes(window.nightStart, "19:00");
  const nightEnd = parseTimeToMinutes(window.nightEnd, "22:00");
  const total = spanHours(dayStart, dayEnd) + spanHours(nightStart, nightEnd);
  return roundTo(clamp(total, 0.5, 16), 0.25);
}

function getStudySessions(window) {
  const cleanWindow = normalizeStudyWindow(window);
  const dayStart = cleanWindow.dayStart;
  const dayEnd = cleanWindow.dayEnd;
  const nightStart = cleanWindow.nightStart;
  const nightEnd = cleanWindow.nightEnd;
  const dayCross = parseTimeToMinutes(dayEnd, "09:00") <= parseTimeToMinutes(dayStart, "06:00");
  const nightCross = parseTimeToMinutes(nightEnd, "22:00") <= parseTimeToMinutes(nightStart, "19:00");
  const dayDurationHours = roundTo(Math.max(0.5, spanHours(parseTimeToMinutes(dayStart, "06:00"), parseTimeToMinutes(dayEnd, "09:00"))), 0.25);
  const nightDurationHours = roundTo(Math.max(0.5, spanHours(parseTimeToMinutes(nightStart, "19:00"), parseTimeToMinutes(nightEnd, "22:00"))), 0.25);
  return [
    { label: "Day", start: dayStart, end: dayEnd, durationHours: dayDurationHours, crossesMidnight: dayCross },
    { label: "Night", start: nightStart, end: nightEnd, durationHours: nightDurationHours, crossesMidnight: nightCross },
  ];
}

function normalizeDateString(value) {
  if (!value) return toInputDate(addDays(startOfDay(new Date()), 30));
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return toInputDate(addDays(startOfDay(new Date()), 30));
  return toInputDate(d);
}

function parseStoredDate(value) {
  const text = normalizeDateString(value);
  const [y, m, d] = text.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function minutesToTime(minutes) {
  const clamped = clamp(minutes, 0, 1439);
  const h = String(Math.floor(clamped / 60)).padStart(2, "0");
  const m = String(clamped % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function normalizeStudyWindow(window) {
  const dayStart = parseTimeToMinutes(window?.dayStart, "06:00");
  const dayEndRaw = parseTimeToMinutes(window?.dayEnd, "09:00");
  const nightStart = parseTimeToMinutes(window?.nightStart, "19:00");
  const nightEndRaw = parseTimeToMinutes(window?.nightEnd, "22:00");

  const dayEnd = dayEndRaw <= dayStart ? Math.min(1439, dayStart + 180) : dayEndRaw;
  const nightEnd = nightEndRaw <= nightStart ? Math.min(1439, nightStart + 180) : nightEndRaw;

  return {
    dayStart: minutesToTime(dayStart),
    dayEnd: minutesToTime(dayEnd),
    nightStart: minutesToTime(nightStart),
    nightEnd: minutesToTime(nightEnd),
  };
}

function formatAllocation(session) {
  if (!session) return "Auto";
  return session.crossesMidnight
    ? `${session.start} to ${session.end} (+1 day)`
    : `${session.start} to ${session.end}`;
}

function bindOptionalExports() {
  byId("exportCsv")?.addEventListener("click", exportCSV);
  byId("exportPdf")?.addEventListener("click", () => window.print());
}

bindOptionalExports();
bindCountdownAnimations();
