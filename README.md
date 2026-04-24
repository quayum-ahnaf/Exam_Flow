# ExamFlow Nova

ExamFlow Nova is a premium, multi-page study planner for turning a syllabus and exam date into a countdown, adaptive timetable, revision engine, recovery flow, focus mode, what-if rescheduler, and export-ready plan.

## Pages

- Home: landing page with countdown, feature cards, and animated previews
- Countdown: live exam counter and progress ring
- Planner: table-based study schedule with priority scoring
- Revisions: spaced repetition timeline
- Recovery: missed-day rebalance view
- Focus: today-only task panel with timer
- What-if: rescheduler for alternate scenarios
- Export: CSV and print-to-PDF preview

## Features

- Auto priority scoring based on difficulty, weightage, time left, and confidence
- Backward planning from the exam date
- Revision spacing with Rev-1, Rev-2, Rev-3
- Missed-day recovery and automatic rebalance
- Weekly mock-test insertion
- Clean table and calendar-style views
- Focus mode with checklist and timer
- CSV export and print-friendly output

## How to run

This is a static HTML/CSS/JS website.

- Open `index.html` directly, or
- Use any static host (VS Code Live Server, GitHub Pages, Netlify, Vercel static, etc.)

## Files

- `index.html` - home page
- `countdown.html` - countdown page
- `planner.html` - study planner
- `revisions.html` - revision page
- `recovery.html` - recovery page
- `focus.html` - focus page
- `rescheduler.html` - what-if page
- `export.html` - export page
- `styles.css` - premium UI styling and animations
- `app.js` - shared planning logic and page interactions
- `.github/copilot-instructions.md` - workspace instructions for Copilot

## Notes

- The current planner uses deterministic heuristics so the UI stays fast and predictable.
- The planner is fully client-side and keeps deterministic logic for speed and predictability.
