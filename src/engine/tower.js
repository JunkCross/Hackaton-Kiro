/* =========================================================
   ENGINE: estado y física de la torre
   ========================================================= */
import { nextBiomeForSession, nextTimeOfDayForSession } from '../data/environmentRoster.js';

export const DOOR_INTERVAL = 5;
export const BASE_WIDTH = 210;
export const MIN_WIDTH = 46;

// --- canvas-relative-physics-balance: constantes y funciones puras de física relativa ---
export const Reference_Canvas_Width = 800; // Requirement 3.1
export const Fall_Threshold_Fraction = 16 / Reference_Canvas_Width;    // Requirement 1.1, evalúa a 0.02
export const Movement_Margin_Fraction = 90 / Reference_Canvas_Width;   // Requirement 2.1, evalúa a 0.1125

// Requirement 1.1/1.3/1.5: Umbral_de_Caida efectivo, proporcional a W, determinista y puro
export function computeFallThreshold(W) {
  return W * Fall_Threshold_Fraction;
}

// Requirement 2.1: Margen_de_Movimiento efectivo, proporcional a canvasWidth
export function computeMovementMargin(canvasWidth) {
  return canvasWidth * Movement_Margin_Fraction;
}

// --- tower-progression-scaling: constantes de progresión ---
export const BASE_PLATFORM_WIDTH = BASE_WIDTH * 3; // 630px, Requirement 1.1
export const SPEED_INCREMENT_FACTOR = 1.30;          // Requirement 2/3
export const BASE_SPEED = 1.6;                       // Velocidad_Base original (sin *floors.length)

// --- endless-tower-difficulty-cap: constantes de Fase_Estable ---
export const STABLE_PHASE_DUEL_THRESHOLD = 5;    // Requirement 1.1, 1.6: Duelos Ganados para entrar en Fase_Estable
export const SPEED_CAP = BASE_SPEED * Math.pow(SPEED_INCREMENT_FACTOR, STABLE_PHASE_DUEL_THRESHOLD); // Tope_Velocidad
export const RELIEF_PLATFORM_FIRST_FLOOR = 35;   // Ajuste de balance: piso absoluto en el que aparece la primera Plataforma_Respiro
export const RELIEF_PLATFORM_REPEAT_INTERVAL = 30; // Ajuste de balance: a partir de RELIEF_PLATFORM_FIRST_FLOOR, se repite cada N pisos (35, 65, 95, 125, ... infinitamente)
export const RELIEF_PLATFORM_WIDTH_MULTIPLIER = 2; // constante vestigial, no se usa actualmente en la lógica, no tocar ni eliminar
export const RELIEF_PLATFORM_SPEED_BOOST_FACTOR = 1.005; // Ajuste de balance: +0.5% de velocidad compuesto en cada aparición de Plataforma_Respiro, acotado a SPEED_CAP
export const RELIEF_PLATFORM_WIDTH_REDUCED_FACTOR = 0.85; // Ajuste de balance: Plataforma_Respiro 15% más angosta (pisos RELIEF_PLATFORM_FIRST_FLOOR..RELIEF_PLATFORM_RANDOM_SIZE_FIRST_FLOOR-1)
export const RELIEF_PLATFORM_RANDOM_SIZE_FIRST_FLOOR = 70; // Ajuste de balance: a partir de este piso absoluto, la Plataforma_Respiro tiene ancho aleatorio (50%-100% de BASE_PLATFORM_WIDTH)
export const SPEED_SPIKE_FIRST_FLOOR = 60;        // Ajuste de balance: piso absoluto del primer pico aleatorio de velocidad
export const SPEED_SPIKE_REPEAT_INTERVAL = 20;    // Ajuste de balance: a partir de SPEED_SPIKE_FIRST_FLOOR, se repite cada N pisos (60, 80, 100, ... infinitamente)
export const SPEED_SPIKE_MIN_MULTIPLIER = 1.3;    // Ajuste de balance: multiplicador mínimo del pico de velocidad, aplicado solo al bloque de ese piso
export const SPEED_SPIKE_MAX_MULTIPLIER = 1.8;    // Ajuste de balance: multiplicador máximo del pico de velocidad, aplicado solo al bloque de ese piso
export const PERFECT_STREAK_BONUS_INTERVAL = 3;   // Requirement 3.4: cada N Duelos Perfectos consecutivos
export const PERFECT_STREAK_BONUS_WIDTH = 40;     // Requirement 3.4: px otorgados por cada bono
export const PERFECT_STREAK_BONUS_ENABLED = false; // Ajuste de balance: deshabilitado temporalmente sin eliminar la mecánica (cambiar a true para reactivar)

// Requirement 1.1 / 1.3 / 1.4: ancho fijo de la Plataforma Base
export function computeBasePlatformWidth() {
  return BASE_PLATFORM_WIDTH; // 630, constante pura sin inputs
}

// Requirement 2.1 / 2.2 / 3.1 / 3.2 / 3.3: incremento compuesto de velocidad
export function applySpeedBoost(currentSpeed) {
  return currentSpeed * SPEED_INCREMENT_FACTOR;
}

// Requirement 1.1/1.2/1.3: aplica el incremento de velocidad solo si aún no se alcanzó
// el Tope_Velocidad (definido a partir de STABLE_PHASE_DUEL_THRESHOLD Duelos Ganados)
export function applySpeedBoostWithCap(currentSpeed, doorsPassedBeforeThisWin) {
  if (doorsPassedBeforeThisWin >= STABLE_PHASE_DUEL_THRESHOLD) {
    return SPEED_CAP; // Requirement 1.2/1.3: ya en Fase_Estable, se mantiene el tope exacto
  }
  const next = applySpeedBoost(currentSpeed); // reutiliza la función pura existente (currentSpeed * 1.30)
  return doorsPassedBeforeThisWin + 1 >= STABLE_PHASE_DUEL_THRESHOLD ? SPEED_CAP : next;
}

// Ajuste de balance: aplica el +0.5% compuesto de velocidad al aparecer una Plataforma_Respiro,
// acotado al mismo Tope_Velocidad (SPEED_CAP) que ya limita el incremento por Duelo Ganado.
export function applyReliefPlatformSpeedBoost(currentSpeed) {
  return Math.min(SPEED_CAP, currentSpeed * RELIEF_PLATFORM_SPEED_BOOST_FACTOR);
}

// --- funciones puras extraídas para PBT (Requirement 1.2) ---

export function computeOverlap(prevFloor, movingBlock) {
  const left = Math.max(movingBlock.x, prevFloor.x);
  const right = Math.min(movingBlock.x + movingBlock.width, prevFloor.x + prevFloor.width);
  return right - left;
}

export function decidesFall(overlap, W = Reference_Canvas_Width) {
  return overlap < computeFallThreshold(W);
}

export function computeNewFloor(prevFloor, movingBlock, isDoor, seed) {
  let x;
  let width;

  if (movingBlock.width > prevFloor.width) {
    // Requirement 2.1/2.2: Bloque en Movimiento premiado (Plataforma_Respiro / Bono_Racha_Perfecta)
    // que aterrizó con éxito (la caída ya fue descartada en dropBlock vía computeOverlap/decidesFall,
    // sin modificar). El piso resultante conserva el ancho y la posición completos del bloque,
    // en vez de recortarse a la intersección con prevFloor.
    x = movingBlock.x;
    width = movingBlock.width;
  } else {
    // Caso normal/legacy (Requirement 3.1): sin cambios respecto al comportamiento actual.
    const left = Math.max(movingBlock.x, prevFloor.x);
    const right = Math.min(movingBlock.x + movingBlock.width, prevFloor.x + prevFloor.width);
    x = left;
    width = right - left;
  }

  return {
    bottom: prevFloor.top, top: prevFloor.top + movingBlock.height,
    x, width, height: movingBlock.height, isDoor, seed,
  };
}

export function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

// --- mutadores de estado equivalentes a los del monolito ---

export function createTowerState(width, height) {
  // Requirement 2.2/2.3: acotar el ancho de la Plataforma Base a `width`
  // en canvases más angostos que BASE_PLATFORM_WIDTH, igual patrón que
  // relief-platform-canvas-clamp; MIN_WIDTH evita anchos degenerados.
  const basePlatformWidth = Math.max(MIN_WIDTH, Math.min(computeBasePlatformWidth(), width ?? Infinity));
  const baseFloor = {
    bottom: 0,
    top: 64,
    x: (width - basePlatformWidth) / 2,
    width: basePlatformWidth,
    height: 64,
    isDoor: false,
    seed: Math.random(),
  };
  
  const clouds = Array.from({length: 7}, (_, i) => ({
    x: Math.random() * 1,
    y: 40 + Math.random() * 260,
    r: 30 + Math.random() * 40,
    speed: 0.15 + Math.random() * 0.2,
    seed: Math.random() * 1000,
  }));

  return {
    screen: 'start', // start | build | boss | gameover | falling
    floors: [baseFloor],
    moving: null,
    moveSpeed: BASE_SPEED, // Requirement 1.5 / 3.4: velocidad persistente en el estado
    perfectStreak: 0,        // Requirement 3.1/3.2/3.3
    streakWidthBonus: 0,     // Requirement 3.4/3.6/3.7/3.8
    camElev: baseFloor.top,
    camElevTarget: baseFloor.top,
    anchorScreenY: height * 0.62,
    knight: {
      elev: baseFloor.top,
      animating: false,
      fromElev: 0,
      toElev: 0,
      animStart: 0,
      animDur: 340,
      falling: false,
      fallStart: 0,
      fallDur: 900,
      fallX: 0,
    },
    doorsPassed: 0,
    pendingBossLevel: 0,
    lastTs: 0,
    clouds,
    torchSeed: Math.random() * 1000,
    activeBiome: nextBiomeForSession(),
    activeTimeOfDay: nextTimeOfDayForSession(),
  };
}

export function topFloor(state) {
  return state.floors[state.floors.length - 1];
}

// Ajuste de balance: determina si el piso absoluto `floorNum` (1-indexed, el mismo
// valor que dropBlock reporta como floorNum una vez colocado) es una Plataforma_Respiro.
// Aparece en el piso 35, y luego cada 30 pisos indefinidamente (65, 95, 125, ...),
// sin depender de la Fase_Estable, de duelos ganados, ni de ningún contador mutable.
export function isReliefPlatformFloor(floorNum) {
  return floorNum >= RELIEF_PLATFORM_FIRST_FLOOR &&
    (floorNum - RELIEF_PLATFORM_FIRST_FLOOR) % RELIEF_PLATFORM_REPEAT_INTERVAL === 0;
}

// Ajuste de balance: determina si el piso absoluto `floorNum` de Plataforma_Respiro
// SHALL usar ancho aleatorio (50%-100% de BASE_PLATFORM_WIDTH) en vez del 85% fijo.
export function isReliefPlatformRandomSizeFloor(floorNum) {
  return floorNum >= RELIEF_PLATFORM_RANDOM_SIZE_FIRST_FLOOR;
}

// Ajuste de balance: determina si el piso absoluto `floorNum` SHALL disparar un pico
// aleatorio de velocidad (aplicado únicamente al bloque en movimiento de ese piso).
// Aparece en el piso 60, y luego cada 20 pisos indefinidamente (80, 100, 120, ...).
export function isSpeedSpikeFloor(floorNum) {
  return floorNum >= SPEED_SPIKE_FIRST_FLOOR &&
    (floorNum - SPEED_SPIKE_FIRST_FLOOR) % SPEED_SPIKE_REPEAT_INTERVAL === 0;
}

export function newMovingBlock(state, afterFloor, canvasWidth) {
  const h = 34 + Math.random() * 20; // 34-54
  const inStablePhase = state.doorsPassed >= STABLE_PHASE_DUEL_THRESHOLD;

  // Requirement 3.4/3.6: ancho máximo base + bonos de racha acumulados
  const maxWidthWithStreakBonus = Math.min(
    afterFloor.width + (inStablePhase ? state.streakWidthBonus : 0),
    canvasWidth ?? Infinity
  );

  let w = Math.max(MIN_WIDTH, Math.min(maxWidthWithStreakBonus, maxWidthWithStreakBonus - Math.random() * 10));

  // Ajuste de balance: Plataforma_Respiro determinada por el número de piso absoluto que se
  // está generando (state.floors.length en este momento ya equivale al floorNum que tendrá
  // este piso una vez colocado — ver dropBlock). Aparece en el piso 35, 65, 95, ... indefinidamente,
  // con ancho fijo igual al largo de la base del castillo (BASE_PLATFORM_WIDTH) y un +0.5%
  // compuesto de velocidad (acotado a SPEED_CAP) que se mantiene hasta la siguiente aparición.
  if (isReliefPlatformFloor(state.floors.length)) {
    // Ajuste de balance: a partir de RELIEF_PLATFORM_RANDOM_SIZE_FIRST_FLOOR (piso 70),
    // el ancho nominal de Plataforma_Respiro es aleatorio entre 50% y 100% de
    // BASE_PLATFORM_WIDTH; antes de eso (pisos 35-69), es un 85% fijo (15% más angosto).
    const nominalReliefWidth = isReliefPlatformRandomSizeFloor(state.floors.length)
      ? BASE_PLATFORM_WIDTH * (0.5 + Math.random() * 0.5)
      : BASE_PLATFORM_WIDTH * RELIEF_PLATFORM_WIDTH_REDUCED_FACTOR;

    // Requirement 2.2/2.3: acotar el ancho "premio" de Plataforma_Respiro a canvasWidth
    // en canvases más angostos que BASE_PLATFORM_WIDTH, igual que ya hace la rama normal;
    // MIN_WIDTH evita anchos degenerados en canvases extremadamente angostos.
    w = Math.max(MIN_WIDTH, Math.min(nominalReliefWidth, canvasWidth ?? Infinity));
    state.moveSpeed = applyReliefPlatformSpeedBoost(state.moveSpeed);
  }

  const effectiveMargin = computeMovementMargin(canvasWidth);
  const minX = Math.max(0, afterFloor.x - effectiveMargin);
  const maxX = Math.min(canvasWidth ?? (afterFloor.x + afterFloor.width + effectiveMargin), afterFloor.x + afterFloor.width + effectiveMargin) - w;

  // El bloque puede arrancar desde la derecha o desde la izquierda aleatoriamente
  const startFromRight = Math.random() < 0.5;
  const dir = startFromRight ? -1 : 1;
  const x = startFromRight ? maxX : minX;

  // Ajuste de balance: pico aleatorio de velocidad cada SPEED_SPIKE_REPEAT_INTERVAL pisos
  // desde SPEED_SPIKE_FIRST_FLOOR (60, 80, 100, ...), aplicado únicamente a este bloque
  // (su propiedad `speed`), sin persistir en state.moveSpeed — el bloque del piso siguiente
  // vuelve automáticamente a la velocidad normal sin necesitar ninguna lógica de reset.
  const speed = isSpeedSpikeFloor(state.floors.length)
    ? state.moveSpeed * (SPEED_SPIKE_MIN_MULTIPLIER + Math.random() * (SPEED_SPIKE_MAX_MULTIPLIER - SPEED_SPIKE_MIN_MULTIPLIER))
    : state.moveSpeed; // sin cambios (ya lee el Tope_Velocidad cuando corresponde)

  return {
    x,
    y: 0,
    width: w,
    height: h,
    dir,
    speed,
    minX,
    maxX,
  };
}

export function resetGame(state, width, height) {
  // Requirement 2.2/2.3: acotar el ancho de la Plataforma Base a `width`
  // en canvases más angostos que BASE_PLATFORM_WIDTH, igual patrón que
  // relief-platform-canvas-clamp; MIN_WIDTH evita anchos degenerados.
  const basePlatformWidth = Math.max(MIN_WIDTH, Math.min(computeBasePlatformWidth(), width ?? Infinity));
  const baseFloor = {
    bottom: 0,
    top: 64,
    x: (width - basePlatformWidth) / 2,
    width: basePlatformWidth,
    height: 64,
    isDoor: false,
    seed: Math.random(),
  };
  
  state.screen = 'start';
  state.floors = [baseFloor];
  state.moveSpeed = BASE_SPEED; // Requirement 3.4: reiniciar velocidad al reconstruir
  state.perfectStreak = 0;
  state.streakWidthBonus = 0;
  state.camElevTarget = baseFloor.top;
  state.camElev = baseFloor.top;
  state.anchorScreenY = height * 0.62;
  state.knight.elev = baseFloor.top;
  state.knight.animating = false;
  state.knight.falling = false;
  state.doorsPassed = 0;
  state.pendingBossLevel = 0;
  state.moving = newMovingBlock(state, baseFloor, width);
  state.activeBiome = nextBiomeForSession(); // Requirement 6.1, 6.4
  state.activeTimeOfDay = nextTimeOfDayForSession(); // Requirement 6.1, 6.4
  state.clouds = Array.from({length: 7}, (_, i) => ({
    x: Math.random() * 1,
    y: 40 + Math.random() * 260,
    r: 30 + Math.random() * 40,
    speed: 0.15 + Math.random() * 0.2,
    seed: Math.random() * 1000,
  }));
}

export function updateDoorCounter(state) {
  const placed = state.floors.length - 1;
  let remain = DOOR_INTERVAL - (placed % DOOR_INTERVAL);
  if (remain === DOOR_INTERVAL && placed === 0) remain = DOOR_INTERVAL;
  return { placed, remain };
}

export function dropBlock(state, width) {
  if (state.screen !== 'build') return null;
  if (!state.moving) return null;
  if (state.knight.animating || state.knight.falling) return null;

  const prev = topFloor(state);
  const moving = state.moving;
  const overlap = computeOverlap(prev, moving);

  if (decidesFall(overlap, width)) {
    return { type: 'fell', floorNum: state.floors.length - 1 };
  }

  const willBeDoor = state.floors.length % DOOR_INTERVAL === 0;
  const newFloor = computeNewFloor(prev, moving, willBeDoor, Math.random());
  state.floors.push(newFloor);

  // knight climbs to the new floor
  state.knight.animating = true;
  state.knight.fromElev = state.knight.elev;
  state.knight.toElev = newFloor.top;
  state.knight.animStart = performance.now();
  state.pendingBossLevel = newFloor.isDoor ? (state.doorsPassed + 1) : 0;

  // prepare next moving block
  const nextMoving = newMovingBlock(state, newFloor, width);
  state.moving = nextMoving;

  return {
    type: 'placed',
    floor: newFloor,
    isDoor: willBeDoor,
    willTriggerBoss: willBeDoor,
    floorNum: state.floors.length - 1,
    doorIn: updateDoorCounter(state).remain,
  };
}

// Requirement 2.1 / 2.2 / 2.3: aplicar incremento de velocidad tras ganar un duelo
export function applyDuelWinSpeedBoost(state) {
  state.moveSpeed = applySpeedBoostWithCap(state.moveSpeed, state.doorsPassed);
  return state.moveSpeed;
}

// Requirement 3.1, 3.2, 3.3: actualiza la Racha_Perfecta según el resultado de un Duelo Ganado
// perfect: boolean — true si el Duelo Ganado no tuvo ningún fallo; se invoca únicamente
// cuando outcome === 'win' (un Duelo perdido/caída se maneja aparte, ver resetPerfectStreak)
export function registerDuelWinForStreak(state, perfect) {
  if (!perfect) {
    state.perfectStreak = 0; // Requirement 3.2
    return state.perfectStreak;
  }
  state.perfectStreak += 1; // Requirement 3.1
  const inStablePhase = state.doorsPassed >= STABLE_PHASE_DUEL_THRESHOLD; // ya incrementado por applyDuelWinSpeedBoost/main.js antes de esta llamada
  if (PERFECT_STREAK_BONUS_ENABLED && inStablePhase && state.perfectStreak % PERFECT_STREAK_BONUS_INTERVAL === 0) {
    state.streakWidthBonus += PERFECT_STREAK_BONUS_WIDTH; // Requirement 3.4, 3.6
  }
  return state.perfectStreak;
}

// Requirement 3.3: pierde el Duelo o cae de la Torre -> Racha_Perfecta a 0 (sin revertir streakWidthBonus, Requirement 3.7)
export function resetPerfectStreak(state) {
  state.perfectStreak = 0;
}

export function triggerFall(state, now) {
  state.screen = 'falling';
  state.knight.falling = true;
  state.knight.fallStart = now;
  state.knight.fallX = 0;
}

export function update(state, dt, now, width) {
  // camera smoothing
  const tf = topFloor(state);
  if (tf) state.camElevTarget = tf.top;
  state.camElev += (state.camElevTarget - state.camElev) * Math.min(1, dt * 0.006);

  if (state.screen === 'build' && state.moving && !state.knight.animating) {
    const m = state.moving;
    m.x += m.dir * m.speed * (dt / 16);
    if (m.x < m.minX) { m.x = m.minX; m.dir = 1; }
    if (m.x > m.maxX) { m.x = m.maxX; m.dir = -1; }
  }

  if (state.knight.animating) {
    const t = Math.min(1, (now - state.knight.animStart) / state.knight.animDur);
    state.knight.elev = state.knight.fromElev + (state.knight.toElev - state.knight.fromElev) * easeOutQuad(t);
    if (t >= 1) {
      state.knight.animating = false;
      // Return indication that boss should start if pending
      if (state.pendingBossLevel > 0) {
        return { shouldStartBoss: true, level: state.pendingBossLevel };
      }
    }
  }

  return { shouldStartBoss: false };
}
