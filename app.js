        /**************************************************************
         * 1. WEB AUDIO SYNTHESIZER (No External Audio Files Needed)
         **************************************************************/
        class SoundEngine {
            constructor() {
                this.ctx = null;
                this.enabled = true;
            }

            init() {
                if (!this.ctx) {
                    const AudioCtx = window.AudioContext || window.webkitAudioContext;
                    if (AudioCtx) this.ctx = new AudioCtx();
                }
                if (this.ctx && this.ctx.state === 'suspended') {
                    this.ctx.resume();
                }
            }

            toggle() {
                this.enabled = !this.enabled;
                return this.enabled;
            }

            playMove(stepIndex) {
                if (!this.enabled) return;
                this.init();
                if (!this.ctx) return;

                const now = this.ctx.currentTime;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                // Subtle soft servo tick
                osc.type = 'triangle';
                const baseFreq = 130 + (stepIndex % 6) * 12;
                osc.frequency.setValueAtTime(baseFreq, now);
                osc.frequency.exponentialRampToValueAtTime(65, now + 0.045);

                gain.gain.setValueAtTime(0.06, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

                osc.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(now);
                osc.stop(now + 0.05);
            }

            playClean(botIndex) {
                if (!this.enabled) return;
                this.init();
                if (!this.ctx) return;

                const now = this.ctx.currentTime;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                // Bright harmonic chime unique per bot
                const pitches = [523.25, 659.25, 783.99]; // C5, E5, G5
                const startFreq = pitches[botIndex % 3];

                osc.type = 'sine';
                osc.frequency.setValueAtTime(startFreq, now);
                osc.frequency.exponentialRampToValueAtTime(startFreq * 1.5, now + 0.16);

                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

                osc.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(now);
                osc.stop(now + 0.19);
            }

            playFinish() {
                if (!this.enabled) return;
                this.init();
                if (!this.ctx) return;

                const notes = [440, 554.37, 659.25, 880];
                notes.forEach((freq, idx) => {
                    const now = this.ctx.currentTime + idx * 0.09;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();

                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, now);

                    gain.gain.setValueAtTime(0.12, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

                    osc.connect(gain);
                    gain.connect(this.ctx.destination);

                    osc.start(now);
                    osc.stop(now + 0.36);
                });
            }
        }

        const sound = new SoundEngine();

        /**************************************************************
         * 2. HOUSE LAYOUT & SIMULATION CONSTANTS (5x4 = 20 Squares)
         **************************************************************/
        const COLS = 5;
        const ROWS = 4;
        const TOTAL_ROOMS = 20;
        const MAX_MOVES = 36;
const DIRT_SPAWN_PROB = 0.35;

        const ROOM_NAMES = [
            "Foyer", "Living N", "Living S", "Sunroom", "Patio",
            "Dining", "Kitchen", "Pantry", "Mudroom", "Garage",
            "Hall W", "Central", "Hall E", "Laundry", "Utility",
            "Master", "Bath M", "Nursery", "Guest", "Study"
        ];

        const BOT_PROFILES = [
            {
                id: 0,
                name: "SweepBot Alpha",
                badge: "Methodical Lawn-Mower",
                color: "#f43f5e", // Rose 500
                glow: "rgba(244, 63, 94, 0.35)",
                lightBg: "rgba(244, 63, 94, 0.12)",
                borderClass: "border-rose-500/40",
                textClass: "text-rose-400",
                bgBadge: "bg-rose-500/20",
                description: "Prefers systematic horizontal sweeps and strongly avoids squares already stored in its internal memory."
            },
            {
                id: 1,
                name: "Curious Scout",
                badge: "Memory-Guided Explorer",
                color: "#06b6d4", // Cyan 500
                glow: "rgba(6, 182, 212, 0.35)",
                lightBg: "rgba(6, 182, 212, 0.12)",
                borderClass: "border-cyan-500/40",
                textClass: "text-cyan-400",
                bgBadge: "bg-cyan-500/20",
                description: "Uses breadth-first spatial memory to plot paths toward unvisited sectors and sniff out adjacent dirty rooms."
            },
            {
                id: 2,
                name: "Chaos Hopper",
                badge: "Impulsive Sprinter",
                color: "#a855f7", // Purple 500
                glow: "rgba(168, 85, 247, 0.35)",
                lightBg: "rgba(168, 85, 247, 0.12)",
                borderClass: "border-purple-500/40",
                textClass: "text-purple-400",
                bgBadge: "bg-purple-500/20",
                description: "Moves with erratic high-energy momentum; remembers rooms it cleaned, yet 45% of the time gambles on random turns."
            }
        ];

        /**************************************************************
         * 3. SIMULATION STATE & ROBOT MEMORY LOGIC
         **************************************************************/
        let rooms = []; // 20 elements: { idx, r, c, name, dirty, dirtParticles, cleanedBy, cleanFlash, dirtFlash }
let spawnedDirtCount = 0;
        let bots = [];
        let floatingPopups = []; // [{ x, y, text, color, alpha, dy }]
        let currentMove = 0;
        let isRunning = false;
        let lastStepTime = 0;
        let stepDurationMs = 420; // Controlled by speed slider
        let activeMemoryFilter = "all"; // 'all', '0', '1', '2'

        function idxFromRC(r, c) {
            return r * COLS + c;
        }

        function rcFromIdx(idx) {
            return { r: Math.floor(idx / COLS), c: idx % COLS };
        }

        function getValidNeighbors(r, c) {
            const dirs = [
                { dr: -1, dc: 0, name: "UP" },
                { dr: 1, dc: 0, name: "DOWN" },
                { dr: 0, dc: -1, name: "LEFT" },
                { dr: 0, dc: 1, name: "RIGHT" }
            ];
            const res = [];
            for (const d of dirs) {
                const nr = r + d.dr;
                const nc = c + d.dc;
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                    res.push({ r: nr, c: nc, idx: idxFromRC(nr, nc), dr: d.dr, dc: d.dc });
                }
            }
            return res;
        }

        // BFS shortest first-step from (startR, startC) to any room NOT in bot's memory
        function findStepTowardUnvisited(bot) {
            const startIdx = idxFromRC(bot.r, bot.c);
            const queue = [{ r: bot.r, c: bot.c, firstStep: null }];
            const seen = new Set([startIdx]);

            while (queue.length > 0) {
                const curr = queue.shift();
                const neighbors = getValidNeighbors(curr.r, curr.c);
                // Shuffle neighbors slightly for variety on ties
                neighbors.sort(() => Math.random() - 0.5);

                for (const nb of neighbors) {
                    if (!seen.has(nb.idx)) {
                        seen.add(nb.idx);
                        const step = curr.firstStep || nb;
                        if (bot.memory[nb.idx] === 0) {
                            return step;
                        }
                        queue.push({ r: nb.r, c: nb.c, firstStep: step });
                    }
                }
            }
            return null;
        }

        function createDirtClumps() {
            const clumps = [];
            for (let i = 0; i < 7; i++) {
                clumps.push({
                    ox: 0.22 + Math.random() * 0.56,
                    oy: 0.25 + Math.random() * 0.52,
                    rad: 2.5 + Math.random() * 3.5
                });
            }
            return clumps;
        }

        function initSimulation() {
            isRunning = false;
            currentMove = 0;
            floatingPopups = [];
            spawnedDirtCount = 0;
            updateControlButtons();

            const initialDirtCount = parseInt(document.getElementById('dirtSelect').value, 10) || 16;

            // Create 20 squares
            rooms = [];
            const indices = Array.from({ length: TOTAL_ROOMS }, (_, i) => i);
            // Shuffle indices to decide which rooms start dirty
            const shuffledForDirt = [...indices].sort(() => Math.random() - 0.5);
            const dirtySet = new Set(shuffledForDirt.slice(0, initialDirtCount));

            for (let i = 0; i < TOTAL_ROOMS; i++) {
                const { r, c } = rcFromIdx(i);
                rooms.push({
                    idx: i,
                    r,
                    c,
                    name: ROOM_NAMES[i],
                    dirty: dirtySet.has(i),
                    dirtParticles: createDirtClumps(),
                    cleanedBy: null,
                    cleanFlash: 0,
                    dirtFlash: 0
                });
            }

            // Pick 3 distinct starting squares for the 3 bots
            const startCandidates = [...indices].sort(() => Math.random() - 0.5);

            bots = BOT_PROFILES.map((profile, bIdx) => {
                const startIdx = startCandidates[bIdx];
                const { r, c } = rcFromIdx(startIdx);
                // Memory state per square (0..19):
                // 0 = Unknown / Unvisited
                // 1 = Visited (Found already clean)
                // 2 = Cleaned by THIS bot! (+3 earned here)
                const memory = new Array(TOTAL_ROOMS).fill(0);

                // Check if starting room is dirty right at spawn (0 moves used yet, we record initial cell visit)
                memory[startIdx] = 1;

                return {
                    ...profile,
                    r,
                    c,
                    prevR: r,
                    prevC: c,
                    animProgress: 1,
                    dirR: 0,
                    dirC: bIdx === 0 ? 1 : (bIdx === 1 ? -1 : 0),
                    sweepRowDir: 1,
                    memory,
                    trail: [{ r, c }],
                    movesMade: 0,
                    roomsCleaned: 0,
                    revisits: 0,
                    score: 0,
                    scoreHistory: [0],
                    lastReason: "Initialized at " + ROOM_NAMES[startIdx]
                };
            });

            document.getElementById('winnerBanner').classList.add('hidden');
            document.getElementById('simStateBadge').textContent = "READY (0/36)";
            document.getElementById('simStateBadge').className = "text-[11px] mono px-2 py-0.5 rounded bg-slate-800 text-slate-300";

            const logEl = document.getElementById('actionLog');
            logEl.innerHTML = `<div class="text-cyan-400">New 20-square house generated (${countDirtyRooms()} dirty squares). Bots spawned at random rooms.</div>`;

            renderBotCards();
            updateHUD();
            drawAllCharts();
        }

        function countDirtyRooms() {
            return rooms.reduce((acc, rm) => acc + (rm.dirty ? 1 : 0), 0);
        }

        function dirtyRoom(idx, { invalidateMemory = false, flash = true } = {}) {
            const room = rooms[idx];
            room.dirty = true;
            room.cleanedBy = null;
            room.dirtParticles = createDirtClumps();
            room.dirtFlash = flash ? 1.0 : 0;
            room.cleanFlash = 0;
            if (invalidateMemory) {
                bots.forEach(bot => {
                    if (bot.memory[idx] === 1 || bot.memory[idx] === 2) {
                        bot.memory[idx] = 0;
                    }
                });
            }
        }

        /**************************************************************
         * 4. PERSONALITY DECISION ENGINE (1 Step = All 3 Bots Move)
         **************************************************************/
        function chooseNextMoveForBot(bot) {
            const neighbors = getValidNeighbors(bot.r, bot.c);

            // PERSONALITY 0: "SweepBot Alpha" (Methodical Zig-Zag + Memory Avoidance)
            if (bot.id === 0) {
                // Score each neighbor based on lawn-mower sweep preference + memory state
                let bestChoice = null;
                let bestWeight = -9999;

                for (const nb of neighbors) {
                    let weight = (Math.random() * 0.4); // slight tie-breaker

                    // Strongly prefer unvisited rooms in memory
                    if (bot.memory[nb.idx] === 0) {
                        weight += 14;
                    } else if (bot.memory[nb.idx] === 1) {
                        weight -= 6; // remembers it visited and it was clean
                    } else if (bot.memory[nb.idx] === 2) {
                        weight -= 10; // remembers it already cleaned this room!
                    }

                    // Horizontal sweep bias
                    if (nb.dc === bot.sweepRowDir && nb.dr === 0) {
                        weight += 8;
                    }
                    // If at horizontal wall, step vertically
                    if ((bot.c === COLS - 1 && bot.sweepRowDir === 1) || (bot.c === 0 && bot.sweepRowDir === -1)) {
                        if (nb.dr !== 0) weight += 10;
                    }

                    if (weight > bestWeight) {
                        bestWeight = weight;
                        bestChoice = nb;
                    }
                }

                // Flip horizontal sweep direction if we changed rows
                if (bestChoice && bestChoice.dr !== 0) {
                    bot.sweepRowDir *= -1;
                }

                const memStatus = bot.memory[bestChoice.idx] === 0 ? "Unvisited in Memory" : "Memory Recall Bypass";
                return { target: bestChoice, reason: `Sweep (${memStatus})` };
            }

            // PERSONALITY 1: "Curious Scout" (Memory-Guided Explorer + Local Dirt Sensor)
            if (bot.id === 1) {
                // 1st priority: Unvisited neighbor that is visibly dirty
                const unvisitedDirty = neighbors.filter(n => bot.memory[n.idx] === 0 && rooms[n.idx].dirty);
                if (unvisitedDirty.length > 0) {
                    const pick = unvisitedDirty[Math.floor(Math.random() * unvisitedDirty.length)];
                    return { target: pick, reason: "Sensor: Adjacent Dirty Square" };
                }

                // 2nd priority: Any unvisited neighbor in memory
                const unvisited = neighbors.filter(n => bot.memory[n.idx] === 0);
                if (unvisited.length > 0) {
                    const pick = unvisited[Math.floor(Math.random() * unvisited.length)];
                    return { target: pick, reason: "Memory: Exploring Uncharted Room" };
                }

                // 3rd priority: Use BFS over internal memory map to navigate toward nearest unvisited room
                const bfsStep = findStepTowardUnvisited(bot);
                if (bfsStep) {
                    return { target: bfsStep, reason: "Memory Pathfinding to Unvisited Zone" };
                }

                // Fallback: random neighbor
                const fallback = neighbors[Math.floor(Math.random() * neighbors.length)];
                return { target: fallback, reason: "Patrolling Known Map" };
            }

            // PERSONALITY 2: "Chaos Hopper" (Impulsive Sprinter - partial memory adherence, high randomness)
            if (bot.id === 2) {
                const gamble = Math.random();
                if (gamble < 0.55) {
                    // 55% of the time: tries to avoid squares it already remembers cleaning/visiting
                    const fresh = neighbors.filter(n => bot.memory[n.idx] === 0);
                    if (fresh.length > 0) {
                        // Prefer keeping momentum if possible
                        const momentumMatch = fresh.find(n => n.dr === bot.dirR && n.dc === bot.dirC);
                        const pick = momentumMatch || fresh[Math.floor(Math.random() * fresh.length)];
                        return { target: pick, reason: "Impulse Dash (Unvisited)" };
                    }
                }
                // 45% of the time (or when boxed in): wild random hop, only avoiding immediate backtrack if possible
                const nonBacktrack = neighbors.filter(n => !(n.r === bot.prevR && n.c === bot.prevC));
                const pool = nonBacktrack.length > 0 ? nonBacktrack : neighbors;
                const pick = pool[Math.floor(Math.random() * pool.length)];
                return { target: pick, reason: "Wild Chaos Hop!" };
            }
        }

        function executeSimulationStep() {
            if (currentMove >= MAX_MOVES) {
                finishSimulation();
                return;
            }

            currentMove++;
            sound.playMove(currentMove);

            // Random dirt spawn at START of step (before bots move), at most 1 per move
            if (Math.random() < DIRT_SPAWN_PROB) {
                const cleanIndices = rooms.filter(rm => !rm.dirty).map(rm => rm.idx);
                if (cleanIndices.length > 0) {
                    const weights = cleanIndices.map(idx => {
                        let w = 1;
                        if (bots.some(b => b.memory[idx] > 0)) w += 4;
                        return w;
                    });
                    const total = weights.reduce((a, b) => a + b, 0);
                    let pick = Math.random() * total;
                    let chosen = cleanIndices[0];
                    for (let i = 0; i < cleanIndices.length; i++) {
                        pick -= weights[i];
                        if (pick <= 0) { chosen = cleanIndices[i]; break; }
                    }
                    dirtyRoom(chosen, { invalidateMemory: true });
                    spawnedDirtCount++;
                    appendLog(`<span class="text-amber-400">Move ${currentMove}: ${rooms[chosen].name} — memory invalidated</span>`);
                }
            }

            // Randomize turn order each step so simultaneous collisions on a dirty square are fair
            const order = [0, 1, 2].sort(() => Math.random() - 0.5);
            let stepLogs = [];

            order.forEach(botIdx => {
                const bot = bots[botIdx];
                const decision = chooseNextMoveForBot(bot);
                const next = decision.target;

                bot.prevR = bot.r;
                bot.prevC = bot.c;
                bot.dirR = next.dr;
                bot.dirC = next.dc;
                bot.r = next.r;
                bot.c = next.c;
                bot.animProgress = 0;

                // Track revisit if already in memory
                if (bot.memory[next.idx] !== 0) {
                    bot.revisits++;
                }

                // Every move costs -1 point
                bot.movesMade++;
                bot.score -= 1;

                const targetRoom = rooms[next.idx];
                let deltaScore = -1;
                let cleanedNow = false;

                if (targetRoom.dirty) {
                    // Clean the room! +3 points
                    targetRoom.dirty = false;
                    targetRoom.cleanedBy = bot.id;
                    targetRoom.cleanFlash = 1.0;

                    bot.roomsCleaned++;
                    bot.score += 3;
                    deltaScore = +2; // (-1 move + 3 clean = +2 net on this turn)
                    cleanedNow = true;

                    // Record in Bot's Memory as "2" (I cleaned this room!)
                    bot.memory[next.idx] = 2;

                    sound.playClean(bot.id);
                    spawnFloatingPopup(next.c, next.r, `+3 Clean! (-1 Move)`, bot.color);
                } else {
                    // Room was already clean. If not already marked as "2" (cleaned by self earlier), mark as "1" (visited & clean)
                    if (bot.memory[next.idx] === 0) {
                        bot.memory[next.idx] = 1;
                    }
                    spawnFloatingPopup(next.c, next.r, `-1 Move`, "#94a3b8");
                }

                bot.trail.push({ r: bot.r, c: bot.c });
                if (bot.trail.length > 10) bot.trail.shift();

                bot.scoreHistory.push(bot.score);
                bot.lastReason = `${decision.reason} → ${targetRoom.name} (${cleanedNow ? '+3 Clean, -1 Move' : '-1 Move'})`;

                stepLogs.push(
                    `<span class="${bot.textClass} font-semibold">[M${currentMove} ${bot.name.split(' ')[0]}]</span> → ${targetRoom.name}: ${
                        cleanedNow ? '<span class="text-emerald-400 font-bold">+3 Clean (-1 Move = +2)</span>' : '<span class="text-rose-400">-1 Move</span>'
                    }`
                );
            });

            appendLog(stepLogs.join(' | '));
            updateHUD();
            renderBotCards();
            drawAllCharts();

            if (currentMove >= MAX_MOVES) {
                finishSimulation();
            }
        }

        function finishSimulation() {
            isRunning = false;
            updateControlButtons();
            sound.playFinish();

            document.getElementById('simStateBadge').textContent = "COMPLETED (36/36)";
            document.getElementById('simStateBadge').className = "text-[11px] mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";

            // Find winner
            const sorted = [...bots].sort((a, b) => b.score - a.score);
            const top = sorted[0];
            const banner = document.getElementById('winnerBanner');
            const winnerText = document.getElementById('winnerText');
            banner.classList.remove('hidden');
            winnerText.innerHTML = `Run Complete! Winner: <strong>${top.name}</strong> (${top.badge}) with <strong>${top.score > 0 ? '+' + top.score : top.score} pts</strong> (${top.roomsCleaned} rooms cleaned)`;

            appendLog(`<span class="text-amber-300 font-bold">★ 36-MOVE SIMULATION COMPLETE! Winner: ${top.name} (${top.score} pts) ★</span>`);
        }

        function appendLog(htmlMsg) {
            const logEl = document.getElementById('actionLog');
            const entry = document.createElement('div');
            entry.className = "border-l-2 border-slate-700 pl-2 py-0.5 leading-relaxed";
            entry.innerHTML = htmlMsg;
            logEl.prepend(entry);
        }

        function spawnFloatingPopup(col, row, text, color) {
            floatingPopups.push({
                col,
                row,
                text,
                color,
                alpha: 1.0,
                offsetY: 0
            });
        }

        /**************************************************************
         * 5. UI CARDS, MEMORY MINI-MAPS & TABLE RENDERING
         **************************************************************/
        function updateHUD() {
            const moveStr = String(currentMove).padStart(2, '0');
            document.getElementById('moveCounterDisplay').textContent = `${moveStr} / ${MAX_MOVES}`;
            document.getElementById('dirtLeftDisplay').textContent = `${countDirtyRooms()} / ${TOTAL_ROOMS}`;
            renderStatsTable();
        }

        function renderBotCards() {
            const container = document.getElementById('botCardsContainer');
            container.innerHTML = bots.map(bot => {
                const visitedCount = bot.memory.filter(m => m > 0).length;
                const cleanedMemoryCount = bot.memory.filter(m => m === 2).length;
                const netScoreFormatted = bot.score > 0 ? `+${bot.score}` : `${bot.score}`;
                const scoreColor = bot.score > 0 ? 'text-emerald-400' : (bot.score < 0 ? 'text-rose-400' : 'text-slate-200');

                // Build 5x4 visual memory grid HTML
                let miniGridCells = '';
                for (let i = 0; i < TOTAL_ROOMS; i++) {
                    const mState = bot.memory[i];
                    const isBotHere = (idxFromRC(bot.r, bot.c) === i);
                    let cellBg = 'bg-slate-900 border-slate-800 text-slate-600';
                    let cellSymbol = '·';

                    if (mState === 2) {
                        // Cleaned by this bot!
                        cellBg = 'bg-emerald-500/30 border-emerald-400 text-emerald-300 font-bold';
                        cellSymbol = '★';
                    } else if (mState === 1) {
                        // Visited (was clean)
                        cellBg = 'bg-slate-700/70 border-slate-500 text-slate-200';
                        cellSymbol = '✓';
                    }

                    const currentRing = isBotHere ? 'ring-2 ring-white z-10 scale-110' : '';
                    miniGridCells += `
                        <div class="w-5 h-4 rounded-[3px] border ${cellBg} ${currentRing} flex items-center justify-center text-[9px] mono transition-all"
                             title="${ROOM_NAMES[i]}: ${mState === 2 ? 'Remembered: Cleaned (+3)' : (mState === 1 ? 'Remembered: Visited (Clean)' : 'Unvisited in Memory')}">
                            ${cellSymbol}
                        </div>
                    `;
                }

                return `
                <div class="bg-slate-900/95 border ${bot.borderClass} rounded-2xl p-3.5 shadow-lg transition hover:bg-slate-900">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex items-center gap-2.5">
                            <div class="w-4 h-4 rounded-full shrink-0" style="background:${bot.color}; box-shadow: 0 0 10px ${bot.color}"></div>
                            <div>
                                <div class="flex items-center gap-2">
                                    <h3 class="text-sm font-bold text-white">${bot.name}</h3>
                                    <span class="text-[10px] px-2 py-0.5 rounded-full ${bot.bgBadge} ${bot.textClass} font-medium">${bot.badge}</span>
                                </div>
                                <p class="text-[11px] text-slate-400 mt-0.5 leading-snug">${bot.description}</p>
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-[10px] uppercase text-slate-400 font-semibold">Net Score</div>
                            <div class="text-lg font-bold mono ${scoreColor}">${netScoreFormatted}</div>
                        </div>
                    </div>

                    <!-- Middle Row: Stats & Internal 5x4 Memory Matrix -->
                    <div class="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
                        <div class="grid grid-cols-3 gap-2 text-center flex-grow">
                            <div class="bg-slate-950/80 border border-slate-800/80 rounded-lg py-1.5 px-2">
                                <div class="text-[10px] text-slate-400">Cleaned (+3)</div>
                                <div class="text-xs font-bold mono text-emerald-400">${bot.roomsCleaned} <span class="text-[10px] text-slate-500">(+${bot.roomsCleaned * 3})</span></div>
                            </div>
                            <div class="bg-slate-950/80 border border-slate-800/80 rounded-lg py-1.5 px-2">
                                <div class="text-[10px] text-slate-400">Moves (-1)</div>
                                <div class="text-xs font-bold mono text-rose-400">${bot.movesMade} <span class="text-[10px] text-slate-500">(-${bot.movesMade})</span></div>
                            </div>
                            <div class="bg-slate-950/80 border border-slate-800/80 rounded-lg py-1.5 px-2">
                                <div class="text-[10px] text-slate-400">Memory Map</div>
                                <div class="text-xs font-bold mono text-cyan-300">${visitedCount}/20 <span class="text-[10px] text-emerald-400">(${cleanedMemoryCount}★)</span></div>
                            </div>
                        </div>

                        <!-- Visual 5x4 Memory Matrix -->
                        <div class="flex flex-col items-center bg-slate-950 p-1.5 rounded-lg border border-slate-800 shrink-0">
                            <span class="text-[9px] uppercase tracking-wider text-slate-400 mb-1">Bot Memory (5×4)</span>
                            <div class="grid grid-cols-5 gap-1">
                                ${miniGridCells}
                            </div>
                        </div>
                    </div>

                    <div class="mt-2 text-[11px] mono text-slate-400 truncate">
                        <span class="text-slate-500">Status:</span> ${bot.lastReason}
                    </div>
                </div>
                `;
            }).join('');
        }

        function renderStatsTable() {
            const tbody = document.getElementById('statsTableBody');
            tbody.innerHTML = bots.map(bot => {
                const uniqueVisited = bot.memory.filter(m => m > 0).length;
                const grossPts = bot.roomsCleaned * 3;
                const movePenalty = -bot.movesMade;
                const netSign = bot.score > 0 ? `+${bot.score}` : bot.score;
                const netClass = bot.score > 0 ? 'text-emerald-400 font-bold' : (bot.score < 0 ? 'text-rose-400 font-bold' : 'text-slate-200 font-bold');

                return `
                    <tr class="hover:bg-slate-800/40 transition">
                        <td class="py-3 px-4 font-sans">
                            <div class="flex items-center gap-2.5">
                                <span class="w-3 h-3 rounded-full shrink-0" style="background:${bot.color}"></span>
                                <div>
                                    <div class="font-semibold text-white">${bot.name}</div>
                                    <div class="text-[11px] text-slate-400">${bot.badge}</div>
                                </div>
                            </div>
                        </td>
                        <td class="py-3 px-4 text-center text-emerald-300 font-semibold">${bot.roomsCleaned} rooms</td>
                        <td class="py-3 px-4 text-center text-emerald-400">+${grossPts} pts</td>
                        <td class="py-3 px-4 text-center text-rose-400">${movePenalty} pts (${bot.movesMade})</td>
                        <td class="py-3 px-4 text-center text-cyan-300">${uniqueVisited} / 20 (${Math.round((uniqueVisited/20)*100)}%)</td>
                        <td class="py-3 px-4 text-center text-amber-400">${bot.revisits} moves</td>
                        <td class="py-3 px-4 text-right text-base ${netClass}">${netSign} pts</td>
                    </tr>
                `;
            }).join('');
        }

        /**************************************************************
         * 6. 20-SQUARE HOUSE CANVAS RENDERER & ANIMATION LOOP
         **************************************************************/
        const houseCanvas = document.getElementById('houseCanvas');
        const hCtx = houseCanvas.getContext('2d');

        function resizeCanvases() {
            const rect = houseCanvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            houseCanvas.width = rect.width * dpr;
            houseCanvas.height = rect.height * dpr;
            hCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

            drawAllCharts();
        }

        window.addEventListener('resize', resizeCanvases);

        function renderHouseCanvas(timestamp) {
            // Handle automatic stepping when running
            if (isRunning) {
                if (timestamp - lastStepTime >= stepDurationMs) {
                    lastStepTime = timestamp;
                    executeSimulationStep();
                }
            }

            // Advance smooth interpolation for bots
            bots.forEach(bot => {
                if (bot.animProgress < 1) {
                    bot.animProgress = Math.min(1, bot.animProgress + (16 / Math.max(80, stepDurationMs * 0.75)));
                }
            });

            const width = houseCanvas.parentElement.clientWidth;
            const height = houseCanvas.parentElement.clientHeight;
            hCtx.clearRect(0, 0, width, height);

            const pad = 12;
            const gridW = width - pad * 2;
            const gridH = height - pad * 2;
            const cellW = gridW / COLS;
            const cellH = gridH / ROWS;

            // 1. Draw Each of the 20 Rooms
            rooms.forEach(room => {
                const x = pad + room.c * cellW;
                const y = pad + room.r * cellH;
                const innerPad = 4;
                const rx = x + innerPad;
                const ry = y + innerPad;
                const rw = cellW - innerPad * 2;
                const rh = cellH - innerPad * 2;

                // Room Background
                hCtx.save();
                hCtx.beginPath();
                hCtx.roundRect(rx, ry, rw, rh, 10);

                if (room.dirty) {
                    // Warm dusty amber floor texture
                    const grad = hCtx.createLinearGradient(rx, ry, rx + rw, ry + rh);
                    grad.addColorStop(0, "rgba(120, 53, 15, 0.42)");
                    grad.addColorStop(1, "rgba(69, 26, 3, 0.65)");
                    hCtx.fillStyle = grad;
                    hCtx.fill();
                    hCtx.lineWidth = 1.5;
                    hCtx.strokeStyle = "rgba(245, 158, 11, 0.45)";
                    hCtx.stroke();
                } else {
                    // Crisp clean slate tile floor
                    const grad = hCtx.createLinearGradient(rx, ry, rx, ry + rh);
                    grad.addColorStop(0, "rgba(30, 41, 59, 0.85)");
                    grad.addColorStop(1, "rgba(15, 23, 42, 0.92)");
                    hCtx.fillStyle = grad;
                    hCtx.fill();
                    hCtx.lineWidth = 1;
                    hCtx.strokeStyle = "rgba(71, 85, 105, 0.45)";
                    hCtx.stroke();
                }

                // Flash animation when recently cleaned
                if (room.cleanFlash > 0) {
                    hCtx.fillStyle = `rgba(16, 185, 129, ${room.cleanFlash * 0.45})`;
                    hCtx.fill();
                    room.cleanFlash = Math.max(0, room.cleanFlash - 0.03);
                }

                // Flash animation when recently dirtied (spawned)
                if (room.dirtFlash > 0) {
                    hCtx.fillStyle = `rgba(239, 68, 68, ${room.dirtFlash * 0.45})`;
                    hCtx.fill();
                    room.dirtFlash = Math.max(0, room.dirtFlash - 0.04);
                }

                // Subtle Floor Tile Grid Lines inside room
                hCtx.strokeStyle = "rgba(255,255,255,0.03)";
                hCtx.lineWidth = 1;
                hCtx.beginPath();
                hCtx.moveTo(rx + rw / 2, ry);
                hCtx.lineTo(rx + rw / 2, ry + rh);
                hCtx.moveTo(rx, ry + rh / 2);
                hCtx.lineTo(rx + rw, ry + rh / 2);
                hCtx.stroke();

                // Room Title & Number
                hCtx.fillStyle = room.dirty ? "#fcd34d" : "#94a3b8";
                hCtx.font = "600 10px Inter, sans-serif";
                hCtx.fillText(`#${room.idx + 1} ${room.name}`, rx + 8, ry + 15);

                // Status Tag in Top-Right of Square
                if (room.dirty) {
                    hCtx.fillStyle = "rgba(245, 158, 11, 0.85)";
                    hCtx.font = "700 9px 'JetBrains Mono', monospace";
                    hCtx.textAlign = "right";
                    hCtx.fillText("DIRTY +3", rx + rw - 7, ry + 15);
                    hCtx.textAlign = "left";

                    // Draw Dust / Dirt Particles
                    room.dirtParticles.forEach(p => {
                        const px = rx + p.ox * rw;
                        const py = ry + p.oy * rh;
                        hCtx.beginPath();
                        hCtx.arc(px, py, p.rad, 0, Math.PI * 2);
                        hCtx.fillStyle = "rgba(217, 119, 6, 0.65)";
                        hCtx.fill();
                        hCtx.strokeStyle = "rgba(251, 191, 36, 0.4)";
                        hCtx.stroke();
                    });
                } else {
                    hCtx.fillStyle = "rgba(52, 211, 153, 0.65)";
                    hCtx.font = "600 9px 'JetBrains Mono', monospace";
                    hCtx.textAlign = "right";
                    hCtx.fillText("CLEAN", rx + rw - 7, ry + 15);
                    hCtx.textAlign = "left";
                }

                // 2. VISUAL BOT MEMORY BADGES IN BOTTOM-LEFT OF EACH ROOM
                // Shows whether each bot remembers visiting (hollow ring) or cleaning (solid glowing badge + star) this room
                const badgeY = ry + rh - 11;
                bots.forEach((bot, bIdx) => {
                    if (activeMemoryFilter !== "all" && String(bIdx) !== activeMemoryFilter) return;

                    const memState = bot.memory[room.idx];
                    const badgeX = rx + 12 + bIdx * 18;

                    if (memState > 0) {
                        // Highlight overlay if single bot memory filter is selected
                        if (activeMemoryFilter !== "all") {
                            hCtx.save();
                            hCtx.beginPath();
                            hCtx.roundRect(rx + 2, ry + 2, rw - 4, rh - 4, 8);
                            hCtx.lineWidth = 2;
                            hCtx.strokeStyle = memState === 2 ? "#10b981" : bot.color;
                            hCtx.stroke();
                            hCtx.restore();
                        }

                        hCtx.beginPath();
                        hCtx.arc(badgeX, badgeY, 6, 0, Math.PI * 2);

                        if (memState === 2) {
                            // Bot remembers it CLEANED this room (+3)
                            hCtx.fillStyle = bot.color;
                            hCtx.fill();
                            hCtx.lineWidth = 1.5;
                            hCtx.strokeStyle = "#ffffff";
                            hCtx.stroke();

                            // Tiny checkmark/star inside
                            hCtx.fillStyle = "#ffffff";
                            hCtx.font = "bold 8px Inter";
                            hCtx.textAlign = "center";
                            hCtx.textBaseline = "middle";
                            hCtx.fillText("★", badgeX, badgeY + 0.5);
                            hCtx.textAlign = "left";
                            hCtx.textBaseline = "alphabetic";
                        } else if (memState === 1) {
                            // Bot remembers visiting this room when it was already clean
                            hCtx.fillStyle = "rgba(15, 23, 42, 0.9)";
                            hCtx.fill();
                            hCtx.lineWidth = 2;
                            hCtx.strokeStyle = bot.color;
                            hCtx.stroke();

                            hCtx.beginPath();
                            hCtx.arc(badgeX, badgeY, 2, 0, Math.PI * 2);
                            hCtx.fillStyle = bot.color;
                            hCtx.fill();
                        }
                    }
                });

                hCtx.restore();
            });

            // 3. Draw Bot Movement Trails
            bots.forEach((bot, bIdx) => {
                if (activeMemoryFilter !== "all" && String(bIdx) !== activeMemoryFilter) return;
                if (bot.trail.length < 2) return;

                hCtx.save();
                hCtx.beginPath();
                bot.trail.forEach((pt, idx) => {
                    const offsetAngle = (bIdx - 1) * 7;
                    const cx = pad + (pt.c + 0.5) * cellW + offsetAngle;
                    const cy = pad + (pt.r + 0.5) * cellH + offsetAngle;
                    if (idx === 0) hCtx.moveTo(cx, cy);
                    else hCtx.lineTo(cx, cy);
                });
                hCtx.strokeStyle = bot.color;
                hCtx.globalAlpha = 0.28;
                hCtx.lineWidth = 3;
                hCtx.setLineDash([4, 4]);
                hCtx.stroke();
                hCtx.restore();
            });

            // 4. Draw the 3 Vacuum Cleaning Robots with Smooth Interpolation
            // Calculate slight visual offset if multiple bots occupy the same square
            const cellOccupancy = {};
            bots.forEach(bot => {
                const key = `${bot.r},${bot.c}`;
                cellOccupancy[key] = (cellOccupancy[key] || 0) + 1;
            });

            const cellRenderedCount = {};

            bots.forEach((bot, bIdx) => {
                const ease = 1 - Math.pow(1 - bot.animProgress, 3); // cubic ease-out
                const interpC = bot.prevC + (bot.c - bot.prevC) * ease;
                const interpR = bot.prevR + (bot.r - bot.prevR) * ease;

                const key = `${bot.r},${bot.c}`;
                const totalInCell = cellOccupancy[key] || 1;
                const slotIdx = cellRenderedCount[key] || 0;
                cellRenderedCount[key] = slotIdx + 1;

                let offsetX = 0;
                let offsetY = 0;
                if (totalInCell > 1) {
                    const angle = (slotIdx / totalInCell) * Math.PI * 2;
                    offsetX = Math.cos(angle) * 14;
                    offsetY = Math.sin(angle) * 12;
                }

                const cx = pad + (interpC + 0.5) * cellW + offsetX;
                const cy = pad + (interpR + 0.5) * cellH + offsetY + 3;
                const radius = Math.min(cellW, cellH) * 0.22;

                hCtx.save();

                // Outer Suction Aura
                const pulse = 1 + Math.sin(timestamp * 0.008 + bIdx * 2) * 0.1;
                hCtx.beginPath();
                hCtx.arc(cx, cy, radius * 1.28 * pulse, 0, Math.PI * 2);
                hCtx.fillStyle = bot.lightBg;
                hCtx.fill();

                // Main Vacuum Disc Chassis
                hCtx.shadowColor = bot.color;
                hCtx.shadowBlur = 12;
                hCtx.beginPath();
                hCtx.arc(cx, cy, radius, 0, Math.PI * 2);
                hCtx.fillStyle = "#0f172a";
                hCtx.fill();
                hCtx.lineWidth = 3;
                hCtx.strokeStyle = bot.color;
                hCtx.stroke();
                hCtx.shadowBlur = 0;

                // Front Bumper Arc indicating movement heading
                const headingAngle = Math.atan2(bot.dirR || 0, bot.dirC || 1);
                hCtx.beginPath();
                hCtx.arc(cx, cy, radius * 0.78, headingAngle - 0.8, headingAngle + 0.8);
                hCtx.lineWidth = 2.5;
                hCtx.strokeStyle = "#ffffff";
                hCtx.stroke();

                // Bot ID Label
                hCtx.fillStyle = "#ffffff";
                hCtx.font = "bold 10px 'JetBrains Mono', monospace";
                hCtx.textAlign = "center";
                hCtx.textBaseline = "middle";
                hCtx.fillText(`B${bIdx + 1}`, cx, cy);

                hCtx.restore();
            });

            // 5. Render Floating Score Popups (+3 Clean / -1 Move)
            for (let i = floatingPopups.length - 1; i >= 0; i--) {
                const pop = floatingPopups[i];
                const px = pad + (pop.col + 0.5) * cellW;
                const py = pad + (pop.row + 0.4) * cellH - pop.offsetY;

                hCtx.save();
                hCtx.font = "bold 11px 'JetBrains Mono', monospace";
                hCtx.textAlign = "center";
                hCtx.fillStyle = pop.color;
                hCtx.globalAlpha = pop.alpha;
                hCtx.fillText(pop.text, px, py);
                hCtx.restore();

                pop.offsetY += 0.6;
                pop.alpha -= 0.022;
                if (pop.alpha <= 0) {
                    floatingPopups.splice(i, 1);
                }
            }

            requestAnimationFrame(renderHouseCanvas);
        }

        /**************************************************************
         * 7. PERFORMANCE CHARTS (Line Trajectory & Grouped Bar Chart)
         **************************************************************/
        function drawAllCharts() {
            drawLineChart();
            drawBarChart();
        }

        function drawLineChart() {
            const canvas = document.getElementById('lineChartCanvas');
            if (!canvas) return;
            const rect = canvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;

            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const w = rect.width;
            const h = rect.height;
            ctx.clearRect(0, 0, w, h);

            const padL = 42, padR = 18, padT = 18, padB = 28;
            const plotW = w - padL - padR;
            const plotH = h - padT - padB;

            // Determine Y-axis bounds dynamically around [-36, +24]
            let minY = -15;
            let maxY = 15;
            bots.forEach(b => {
                b.scoreHistory.forEach(val => {
                    if (val < minY) minY = val - 3;
                    if (val > maxY) maxY = val + 3;
                });
            });

            const yToPx = (val) => padT + plotH - ((val - minY) / (maxY - minY)) * plotH;
            const xToPx = (step) => padL + (step / MAX_MOVES) * plotW;

            // Horizontal Grid Lines & Zero Line
            const stepsY = 5;
            ctx.font = "10px 'JetBrains Mono', monospace";
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";

            for (let i = 0; i <= stepsY; i++) {
                const val = Math.round(minY + (i / stepsY) * (maxY - minY));
                const py = yToPx(val);
                ctx.beginPath();
                ctx.moveTo(padL, py);
                ctx.lineTo(w - padR, py);
                ctx.strokeStyle = val === 0 ? "rgba(148, 163, 184, 0.45)" : "rgba(51, 65, 85, 0.4)";
                ctx.lineWidth = val === 0 ? 1.5 : 1;
                ctx.stroke();

                ctx.fillStyle = "#64748b";
                ctx.fillText(val > 0 ? `+${val}` : val, padL - 6, py);
            }

            // X-Axis Labels (Moves 0..36)
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            [0, 6, 12, 18, 24, 30, 36].forEach(m => {
                const px = xToPx(m);
                ctx.fillStyle = "#64748b";
                ctx.fillText(`M${m}`, px, h - padB + 8);
            });

            // Plot Each Bot's Score History Line
            bots.forEach(bot => {
                if (bot.scoreHistory.length === 0) return;

                ctx.save();
                ctx.beginPath();
                bot.scoreHistory.forEach((sc, idx) => {
                    const px = xToPx(idx);
                    const py = yToPx(sc);
                    if (idx === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                });
                ctx.strokeStyle = bot.color;
                ctx.lineWidth = 2.5;
                ctx.stroke();

                // End point dot
                const lastIdx = bot.scoreHistory.length - 1;
                const endX = xToPx(lastIdx);
                const endY = yToPx(bot.scoreHistory[lastIdx]);
                ctx.beginPath();
                ctx.arc(endX, endY, 4, 0, Math.PI * 2);
                ctx.fillStyle = bot.color;
                ctx.fill();
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.restore();
            });
        }

        function drawBarChart() {
            const canvas = document.getElementById('barChartCanvas');
            if (!canvas) return;
            const rect = canvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;

            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const w = rect.width;
            const h = rect.height;
            ctx.clearRect(0, 0, w, h);

            const padL = 42, padR = 18, padT = 22, padB = 32;
            const plotW = w - padL - padR;
            const plotH = h - padT - padB;

            const minVal = -60;
            const maxVal = 70;
            const zeroY = padT + plotH - ((0 - minVal) / (maxVal - minVal)) * plotH;
            const valToY = (v) => padT + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

            // Grid lines
            ctx.font = "10px 'JetBrains Mono', monospace";
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            [-36, -18, 0, 18, 36].forEach(v => {
                const py = valToY(v);
                ctx.beginPath();
                ctx.moveTo(padL, py);
                ctx.lineTo(w - padR, py);
                ctx.strokeStyle = v === 0 ? "rgba(148, 163, 184, 0.5)" : "rgba(51, 65, 85, 0.35)";
                ctx.lineWidth = v === 0 ? 1.5 : 1;
                ctx.stroke();

                ctx.fillStyle = "#64748b";
                ctx.fillText(v > 0 ? `+${v}` : v, padL - 6, py);
            });

            // Draw 3 groups (one per bot): [Gross Clean Pts (+), Move Penalty (-), Net Score]
            const groupW = plotW / 3;
            const barW = Math.min(26, groupW * 0.22);

            bots.forEach((bot, bIdx) => {
                const centerX = padL + groupW * (bIdx + 0.5);
                const gross = bot.roomsCleaned * 3;
                const penalty = -bot.movesMade;
                const net = bot.score;

                const metrics = [
                    { val: gross, color: "#10b981", label: `+${gross}` },
                    { val: penalty, color: "#f43f5e", label: `${penalty}` },
                    { val: net, color: bot.color, label: net > 0 ? `+${net}` : `${net}` }
                ];

                metrics.forEach((m, mIdx) => {
                    const bx = centerX + (mIdx - 1.5) * (barW + 4) + 2;
                    const by = m.val >= 0 ? valToY(m.val) : zeroY;
                    const bh = Math.max(2, Math.abs(valToY(m.val) - zeroY));

                    ctx.save();
                    ctx.beginPath();
                    ctx.roundRect(bx, by, barW, bh, 4);
                    ctx.fillStyle = m.color;
                    ctx.fill();

                    // Value label
                    ctx.fillStyle = "#e2e8f0";
                    ctx.font = "600 9px 'JetBrains Mono', monospace";
                    ctx.textAlign = "center";
                    const labelY = m.val >= 0 ? by - 7 : by + bh + 9;
                    ctx.fillText(m.label, bx + barW / 2, labelY);
                    ctx.restore();
                });

                // Bot Name Label on X-axis
                ctx.fillStyle = bot.color;
                ctx.font = "600 11px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(bot.name, centerX, h - padB + 14);
            });
        }

        /**************************************************************
         * 8. EVENT LISTENERS & INTERACTION BINDINGS
         **************************************************************/
        function updateControlButtons() {
            const txtStart = document.getElementById('txtStart');
            const btnStart = document.getElementById('btnStart');

            if (isRunning) {
                txtStart.textContent = "Pause Run";
                btnStart.className = "px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-amber-600/20 transition all flex items-center gap-1.5 active:scale-95";
                document.getElementById('simStateBadge').textContent = `RUNNING (${currentMove}/36)`;
                document.getElementById('simStateBadge').className = "text-[11px] mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40";
            } else {
                txtStart.textContent = currentMove >= MAX_MOVES ? "Restart Run" : (currentMove > 0 ? "Resume Run" : "Start Run");
                btnStart.className = "px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-emerald-600/20 transition all flex items-center gap-1.5 active:scale-95";
            }
        }

        document.getElementById('btnStart').addEventListener('click', () => {
            sound.init();
            if (currentMove >= MAX_MOVES) {
                initSimulation();
                isRunning = true;
            } else {
                isRunning = !isRunning;
            }
            lastStepTime = performance.now();
            updateControlButtons();
        });

        document.getElementById('btnStep').addEventListener('click', () => {
            sound.init();
            isRunning = false;
            updateControlButtons();
            if (currentMove < MAX_MOVES) {
                executeSimulationStep();
            }
        });

        document.getElementById('btnNewRun').addEventListener('click', () => {
            sound.init();
            initSimulation();
        });

        document.getElementById('dirtSelect').addEventListener('change', () => {
            initSimulation();
        });

        document.getElementById('speedSlider').addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            // 1 = 800ms, 2 = 580ms, 3 = 400ms, 4 = 240ms, 5 = 110ms
            const speeds = [800, 580, 400, 240, 110];
            stepDurationMs = speeds[val - 1] || 400;
        });

        document.getElementById('btnSound').addEventListener('click', () => {
            const on = sound.toggle();
            document.getElementById('iconSoundOn').classList.toggle('hidden', !on);
            document.getElementById('iconSoundOff').classList.toggle('hidden', on);
        });

        // Memory Filter Buttons
        document.querySelectorAll('.mem-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeMemoryFilter = btn.getAttribute('data-filter');
                document.querySelectorAll('.mem-btn').forEach(b => {
                    b.classList.remove('bg-cyan-500/20', 'text-cyan-300', 'border-cyan-500/40', 'ring-1', 'ring-cyan-400');
                });
                btn.classList.add('ring-1', 'ring-cyan-400');
            });
        });

        // Allow clicking any room on the House Canvas to toggle its Dirty/Clean state for experimentation
        houseCanvas.addEventListener('click', (e) => {
            const rect = houseCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const pad = 12;
            const cellW = (rect.width - pad * 2) / COLS;
            const cellH = (rect.height - pad * 2) / ROWS;

            const c = Math.floor((x - pad) / cellW);
            const r = Math.floor((y - pad) / cellH);
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
                const idx = idxFromRC(r, c);
                if (rooms[idx].dirty) {
                    rooms[idx].dirty = false;
                } else {
                    dirtyRoom(idx, { invalidateMemory: true });
                }
                updateHUD();
            }
        });

        // Boot up on window load
        window.onload = function () {
            initSimulation();
            resizeCanvases();
            requestAnimationFrame(renderHouseCanvas);
        };
