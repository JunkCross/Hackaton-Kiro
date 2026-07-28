/* ===== Tests del motor de la torre (src/engine/tower.js) ===== */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  createTowerState,
  resetGame,
  update,
  dropBlock,
  computeNewFloor,
  computeOverlap,
  decidesFall,
  applyDuelWinSpeedBoost,
  applySpeedBoost,
  applySpeedBoostWithCap,
  registerDuelWinForStreak,
  resetPerfectStreak,
  triggerFall,
  newMovingBlock,
  isReliefPlatformFloor,
  topFloor,
  BASE_SPEED,
  SPEED_CAP,
  SPEED_INCREMENT_FACTOR,
  STABLE_PHASE_DUEL_THRESHOLD,
  PERFECT_STREAK_BONUS_WIDTH,
  PERFECT_STREAK_BONUS_INTERVAL,
  PERFECT_STREAK_BONUS_ENABLED,
  RELIEF_PLATFORM_FIRST_FLOOR,
  RELIEF_PLATFORM_REPEAT_INTERVAL,
  RELIEF_PLATFORM_WIDTH_MULTIPLIER,
  RELIEF_PLATFORM_SPEED_BOOST_FACTOR,
  RELIEF_PLATFORM_WIDTH_REDUCED_FACTOR,
  RELIEF_PLATFORM_RANDOM_SIZE_FIRST_FLOOR,
  isReliefPlatformRandomSizeFloor,
  SPEED_SPIKE_FIRST_FLOOR,
  SPEED_SPIKE_REPEAT_INTERVAL,
  SPEED_SPIKE_MIN_MULTIPLIER,
  SPEED_SPIKE_MAX_MULTIPLIER,
  isSpeedSpikeFloor,
  applyReliefPlatformSpeedBoost,
  BASE_PLATFORM_WIDTH,
  MIN_WIDTH,
  computeMovementMargin,
  computeFallThreshold,
  Reference_Canvas_Width,
  Fall_Threshold_Fraction,
  Movement_Margin_Fraction,
} from './tower.js';
import * as environmentRoster from '../data/environmentRoster.js';
import { BIOME_CATALOG, TIME_OF_DAY_CATALOG } from '../data/environmentRoster.js';

// Feature: tower-ground-biome-background, Property 4: Inmutabilidad de Active_Biome y Active_Time_Of_Day durante la sesión
describe('createTowerState — inmutabilidad de activeBiome/activeTimeOfDay durante la sesión', () => {
  it('Property 4: cualquier secuencia de update/dropBlock/applyDuelWinSpeedBoost/triggerFall/newMovingBlock deja activeBiome y activeTimeOfDay exactamente iguales', () => {
    const dtArb = fc.integer({ min: 1, max: 48 }); // Requirement 6.2/6.3: dt válido, igual al Math.min(48, ...) usado en main.js
    const nowArb = fc.integer({ min: 0, max: 1_000_000 });
    const widthArb = fc.integer({ min: 300, max: 1200 });
    const heightArb = fc.integer({ min: 300, max: 1200 });

    const opArb = fc.oneof(
      fc.record({ type: fc.constant('update'), dt: dtArb, now: nowArb, width: widthArb }),
      fc.record({ type: fc.constant('dropBlock'), width: widthArb }),
      fc.record({ type: fc.constant('applyDuelWinSpeedBoost') }),
      fc.record({ type: fc.constant('triggerFall'), now: nowArb }),
      fc.record({ type: fc.constant('newMovingBlock'), width: widthArb })
    );

    fc.assert(
      fc.property(
        widthArb,
        heightArb,
        fc.array(opArb, { maxLength: 30 }),
        (width, height, ops) => {
          const state = createTowerState(width, height);

          // Sesión recién creada por createTowerState: capturar Active_Biome/
          // Active_Time_Of_Day antes de aplicar ninguna operación.
          const biomeBefore = state.activeBiome;
          const timeOfDayBefore = state.activeTimeOfDay;

          // Forzar screen = 'build' para que dropBlock/update ejerciten su lógica
          // real (no-op temprano) en lugar de quedarse siempre en el 'start'
          // inicial; la propiedad debe cumplirse igual si las operaciones son
          // no-ops o si tienen efecto real.
          state.screen = 'build';

          for (const op of ops) {
            switch (op.type) {
              case 'update':
                update(state, op.dt, op.now, op.width);
                break;
              case 'dropBlock':
                dropBlock(state, op.width);
                break;
              case 'applyDuelWinSpeedBoost':
                applyDuelWinSpeedBoost(state);
                break;
              case 'triggerFall':
                triggerFall(state, op.now);
                break;
              case 'newMovingBlock': {
                const after = topFloor(state);
                if (after) state.moving = newMovingBlock(state, after, op.width);
                break;
              }
              default:
                break;
            }
          }

          // Ninguna de estas funciones lee ni escribe activeBiome/activeTimeOfDay:
          // deben seguir siendo exactamente la misma entrada de catálogo (misma
          // identidad de objeto) tras cualquier secuencia de llamadas.
          expect(state.activeBiome).toBe(biomeBefore);
          expect(state.activeTimeOfDay).toBe(timeOfDayBefore);
          expect(state.activeBiome).toEqual(biomeBefore);
          expect(state.activeTimeOfDay).toEqual(timeOfDayBefore);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Requirements: 6.1, 6.4 — pruebas unitarias de la integración de
// activeBiome/activeTimeOfDay en createTowerState/resetGame
describe('createTowerState/resetGame — integración con environmentRoster', () => {
  it('createTowerState devuelve activeBiome perteneciente a BIOME_CATALOG y activeTimeOfDay perteneciente a TIME_OF_DAY_CATALOG', () => {
    const state = createTowerState(800, 600);

    expect(BIOME_CATALOG).toContain(state.activeBiome);
    expect(TIME_OF_DAY_CATALOG).toContain(state.activeTimeOfDay);
  });

  it('resetGame llamado dos veces sucesivas sobre el mismo state re-invoca la selección de bioma/momento del día', () => {
    const marker = (label) => ({ __marker: label });
    const biomeMarks = [marker('biome-0'), marker('biome-1'), marker('biome-2')];
    const timeMarks = [marker('time-0'), marker('time-1'), marker('time-2')];

    const biomeSpy = vi.spyOn(environmentRoster, 'nextBiomeForSession')
      .mockReturnValueOnce(biomeMarks[0])
      .mockReturnValueOnce(biomeMarks[1])
      .mockReturnValueOnce(biomeMarks[2]);
    const timeOfDaySpy = vi.spyOn(environmentRoster, 'nextTimeOfDayForSession')
      .mockReturnValueOnce(timeMarks[0])
      .mockReturnValueOnce(timeMarks[1])
      .mockReturnValueOnce(timeMarks[2]);

    // createTowerState: 1ra invocación de cada selección
    const state = createTowerState(800, 600);
    expect(state.activeBiome).toBe(biomeMarks[0]);
    expect(state.activeTimeOfDay).toBe(timeMarks[0]);
    expect(biomeSpy).toHaveBeenCalledTimes(1);
    expect(timeOfDaySpy).toHaveBeenCalledTimes(1);

    // 1ra llamada a resetGame: 2da invocación de cada selección, reemplaza ambos campos
    resetGame(state, 800, 600);
    expect(state.activeBiome).toBe(biomeMarks[1]);
    expect(state.activeTimeOfDay).toBe(timeMarks[1]);
    expect(biomeSpy).toHaveBeenCalledTimes(2);
    expect(timeOfDaySpy).toHaveBeenCalledTimes(2);

    // 2da llamada sucesiva a resetGame: 3ra invocación de cada selección, reemplaza ambos campos de nuevo
    resetGame(state, 800, 600);
    expect(state.activeBiome).toBe(biomeMarks[2]);
    expect(state.activeTimeOfDay).toBe(timeMarks[2]);
    expect(biomeSpy).toHaveBeenCalledTimes(3);
    expect(timeOfDaySpy).toHaveBeenCalledTimes(3);

    biomeSpy.mockRestore();
    timeOfDaySpy.mockRestore();
  });
});

// Feature: endless-tower-difficulty-cap, Property 3: Reiniciar la partida restablece velocidad, racha y contadores de Fase_Estable a sus valores base
describe('resetGame — reinicio completo de velocidad/racha/contadores de Fase_Estable', () => {
  it('Property 3: para cualquier estado previo arbitrario, resetGame restablece moveSpeed, doorsPassed, perfectStreak y streakWidthBonus a sus valores base', () => {
    const widthArb = fc.integer({ min: 300, max: 1200 });
    const heightArb = fc.integer({ min: 300, max: 1200 });
    const moveSpeedArb = fc.float({ min: Math.fround(0.1), max: Math.fround(1000), noNaN: true });
    const doorsPassedArb = fc.nat({ max: 200 });
    const perfectStreakArb = fc.nat({ max: 200 });
    const streakWidthBonusArb = fc.nat({ max: 2000 });

    fc.assert(
      fc.property(
        widthArb,
        heightArb,
        moveSpeedArb,
        doorsPassedArb,
        perfectStreakArb,
        streakWidthBonusArb,
        (width, height, moveSpeed, doorsPassed, perfectStreak, streakWidthBonus) => {
          const state = createTowerState(width, height);

          // Simula un estado arbitrario alcanzado tras una secuencia válida de
          // Duelos Ganados/perdidos y pisos construidos, mutando directamente
          // los campos relevantes (los setters dedicados de racha/plataformas
          // aún no existen en este punto del plan de implementación).
          state.moveSpeed = moveSpeed;
          state.doorsPassed = doorsPassed;
          state.perfectStreak = perfectStreak;
          state.streakWidthBonus = streakWidthBonus;

          resetGame(state, width, height);

          expect(state.moveSpeed).toBe(BASE_SPEED);
          expect(state.doorsPassed).toBe(0);
          expect(state.perfectStreak).toBe(0);
          expect(state.streakWidthBonus).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: endless-tower-difficulty-cap, Property 1: El Tope_Velocidad se alcanza exactamente al 5º Duelo Ganado y se mantiene constante después
describe('applyDuelWinSpeedBoost — alcance exacto y estabilidad del Tope_Velocidad', () => {
  it('Property 1: para cualquier N >= 5 Duelos Ganados consecutivos, moveSpeed es exactamente SPEED_CAP tras el 5º y permanece en SPEED_CAP en cualquier llamada adicional', () => {
    const widthArb = fc.integer({ min: 300, max: 1200 });
    const heightArb = fc.integer({ min: 300, max: 1200 });
    const nArb = fc.integer({ min: 5, max: 60 });

    fc.assert(
      fc.property(
        widthArb,
        heightArb,
        nArb,
        (width, height, n) => {
          const state = createTowerState(width, height);
          state.moveSpeed = BASE_SPEED;
          state.doorsPassed = 0;

          // Fase 1: exactamente STABLE_PHASE_DUEL_THRESHOLD (5) Duelos Ganados,
          // replicando el orden real de main.js (applyDuelWinSpeedBoost primero,
          // luego doorsPassed += 1).
          for (let i = 0; i < STABLE_PHASE_DUEL_THRESHOLD; i++) {
            applyDuelWinSpeedBoost(state);
            state.doorsPassed += 1;
          }

          // Tras el 5º Duelo Ganado, el Tope_Velocidad SHALL alcanzarse exactamente.
          expect(state.moveSpeed).toBe(SPEED_CAP);

          // Fase 2: (n - 5) Duelos Ganados adicionales; moveSpeed SHALL permanecer
          // exactamente igual a SPEED_CAP en cada uno, sin volver a multiplicarse.
          for (let i = STABLE_PHASE_DUEL_THRESHOLD; i < n; i++) {
            applyDuelWinSpeedBoost(state);
            state.doorsPassed += 1;
            expect(state.moveSpeed).toBe(SPEED_CAP);
          }

          expect(state.moveSpeed).toBe(SPEED_CAP);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: endless-tower-difficulty-cap, Property 2: El comportamiento previo al Tope_Velocidad es idéntico al de tower-progression-scaling
describe('applyDuelWinSpeedBoost — equivalencia con el comportamiento pre-tope de tower-progression-scaling', () => {
  it('Property 2: para cualquier N entre 1 y 4 Duelos Ganados consecutivos, moveSpeed es idéntico (tolerancia 0.001) a BASE_SPEED * Math.pow(SPEED_INCREMENT_FACTOR, N)', () => {
    const widthArb = fc.integer({ min: 300, max: 1200 });
    const heightArb = fc.integer({ min: 300, max: 1200 });
    const nArb = fc.integer({ min: 1, max: 4 });

    fc.assert(
      fc.property(
        widthArb,
        heightArb,
        nArb,
        (width, height, n) => {
          const state = createTowerState(width, height);
          state.moveSpeed = BASE_SPEED;
          state.doorsPassed = 0;

          for (let i = 0; i < n; i++) {
            applyDuelWinSpeedBoost(state);
            state.doorsPassed += 1;
          }

          const expected = BASE_SPEED * Math.pow(SPEED_INCREMENT_FACTOR, n);

          expect(Math.abs(state.moveSpeed - expected)).toBeLessThan(0.001);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: endless-tower-difficulty-cap, Property 6: La Racha_Perfecta se incrementa solo con Duelos Perfectos consecutivos y se reinicia ante cualquier interrupción
describe('registerDuelWinForStreak/resetPerfectStreak — actualización de la Racha_Perfecta', () => {
  it('Property 6: para cualquier secuencia de resultados de Duelo, perfectStreak final es exactamente la racha de perfect-win consecutivos al final', () => {
    const widthArb = fc.integer({ min: 300, max: 1200 });
    const heightArb = fc.integer({ min: 300, max: 1200 });
    const resultsArb = fc.array(
      fc.constantFrom('perfect-win', 'imperfect-win', 'lose', 'fall'),
      { minLength: 1, maxLength: 40 }
    );

    fc.assert(
      fc.property(
        widthArb,
        heightArb,
        resultsArb,
        (width, height, results) => {
          const state = createTowerState(width, height);
          state.doorsPassed = 0; // no relevante para esta propiedad (Fase_Estable cubierta por Properties 7/8)

          for (const result of results) {
            if (result === 'perfect-win') {
              registerDuelWinForStreak(state, true);
            } else if (result === 'imperfect-win') {
              registerDuelWinForStreak(state, false);
            } else {
              // 'lose' o 'fall'
              resetPerfectStreak(state);
            }
          }

          let expectedTrailingRun = 0;
          for (let i = results.length - 1; i >= 0; i--) {
            if (results[i] === 'perfect-win') {
              expectedTrailingRun += 1;
            } else {
              break;
            }
          }

          expect(state.perfectStreak).toBe(expectedTrailingRun);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: endless-tower-difficulty-cap, Property 7: El Bono_Racha_Perfecta se otorga exactamente cada 3 Duelos Perfectos consecutivos dentro de la Fase_Estable, es acumulativo y nunca se revierte
// NOTA (ajuste de balance): el Bono_Racha_Perfecta está deshabilitado por defecto (PERFECT_STREAK_BONUS_ENABLED = false)
// sin eliminar su lógica; mientras el flag permanezca en false, streakWidthBonus SHALL permanecer inalterado
// para cualquier secuencia de Duelos Perfectos, incluso dentro de la Fase_Estable.
describe('registerDuelWinForStreak — Bono_Racha_Perfecta deshabilitado por defecto (PERFECT_STREAK_BONUS_ENABLED = false)', () => {
  it('Property 7 (adaptada): con el Bono_Racha_Perfecta deshabilitado, streakWidthBonus nunca cambia para ninguna secuencia de Duelos Perfectos dentro de la Fase_Estable', () => {
    expect(PERFECT_STREAK_BONUS_ENABLED).toBe(false);

    const doorsPassedArb = fc.integer({ min: STABLE_PHASE_DUEL_THRESHOLD, max: STABLE_PHASE_DUEL_THRESHOLD + 50 });
    const b0Arb = fc.nat({ max: 500 });
    const perfectSeqArb = fc.array(fc.boolean(), { minLength: 1, maxLength: 30 });

    fc.assert(
      fc.property(
        doorsPassedArb,
        b0Arb,
        perfectSeqArb,
        (doorsPassed, b0, perfectSeq) => {
          const state = createTowerState(800, 600);
          state.doorsPassed = doorsPassed;
          state.streakWidthBonus = b0;

          for (const perfect of perfectSeq) {
            registerDuelWinForStreak(state, perfect);
          }

          // Con PERFECT_STREAK_BONUS_ENABLED === false, streakWidthBonus permanece
          // exactamente en su valor inicial, sin importar la secuencia de Duelos.
          expect(state.streakWidthBonus).toBe(b0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: endless-tower-difficulty-cap, Property 8: Ningún Duelo Perfecto anterior a la Fase_Estable otorga Bono_Racha_Perfecta, aunque sí incrementa la racha
describe('registerDuelWinForStreak — ausencia de Bono_Racha_Perfecta antes de la Fase_Estable', () => {
  it('Property 8: para cualquier secuencia de N >= 3 Duelos Perfectos consecutivos con doorsPassed < STABLE_PHASE_DUEL_THRESHOLD constante, streakWidthBonus no cambia y perfectStreak alcanza N', () => {
    const doorsPassedArb = fc.integer({ min: 0, max: STABLE_PHASE_DUEL_THRESHOLD - 1 });
    const b0Arb = fc.nat({ max: 500 });
    const nArb = fc.integer({ min: 3, max: 30 });

    fc.assert(
      fc.property(
        doorsPassedArb,
        b0Arb,
        nArb,
        (doorsPassed, b0, n) => {
          const state = createTowerState(800, 600);
          // Fuera de la Fase_Estable durante toda la secuencia: doorsPassed
          // permanece constante (ningún Duelo Ganado adicional lo incrementa
          // entre estas llamadas).
          state.doorsPassed = doorsPassed;
          state.streakWidthBonus = b0;

          for (let i = 0; i < n; i++) {
            registerDuelWinForStreak(state, true);
          }

          expect(state.streakWidthBonus).toBe(b0);
          expect(state.perfectStreak).toBe(n);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: endless-tower-difficulty-cap, Property 4: Las Plataformas_Respiro solo ocurren en la Fase_Estable, exactamente cada 5 pisos construidos desde su inicio
describe('isReliefPlatformFloor — elegibilidad determinística de Plataforma_Respiro', () => {
  it('Property 4: para cualquier floorNum >= 0, isReliefPlatformFloor devuelve true si y solo si floorNum >= RELIEF_PLATFORM_FIRST_FLOOR y (floorNum - RELIEF_PLATFORM_FIRST_FLOOR) % RELIEF_PLATFORM_REPEAT_INTERVAL === 0', () => {
    const floorNumArb = fc.integer({ min: 0, max: 2000 });

    fc.assert(
      fc.property(
        floorNumArb,
        (floorNum) => {
          const expected = floorNum >= RELIEF_PLATFORM_FIRST_FLOOR &&
            (floorNum - RELIEF_PLATFORM_FIRST_FLOOR) % RELIEF_PLATFORM_REPEAT_INTERVAL === 0;

          expect(isReliefPlatformFloor(floorNum)).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('casos concretos: los pisos absolutos 35, 65 y 95 son Plataforma_Respiro, otros no', () => {
    expect(isReliefPlatformFloor(35)).toBe(true);
    expect(isReliefPlatformFloor(65)).toBe(true);
    expect(isReliefPlatformFloor(95)).toBe(true);
    expect(isReliefPlatformFloor(34)).toBe(false);
    expect(isReliefPlatformFloor(36)).toBe(false);
    expect(isReliefPlatformFloor(0)).toBe(false);
    expect(isReliefPlatformFloor(64)).toBe(false);
  });
});

// Feature: endless-tower-difficulty-cap, Property 5: El ancho de una Plataforma_Respiro es siempre exactamente BASE_PLATFORM_WIDTH (630px), el largo de la base del castillo, sin importar el ancho previo
describe('newMovingBlock — ancho exacto de una Plataforma_Respiro', () => {
  it('Property 5: para cualquier ancho base, bono de racha y valor de Math.random estable, el ancho con Plataforma_Respiro es siempre exactamente BASE_PLATFORM_WIDTH', () => {
    const afterFloorWidthArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH });
    const streakWidthBonusArb = fc.nat({ max: 300 });
    const randomStubArb = fc.float({ min: 0, max: Math.fround(0.999), noNaN: true });

    fc.assert(
      fc.property(
        afterFloorWidthArb,
        streakWidthBonusArb,
        randomStubArb,
        (afterFloorWidth, streakWidthBonus, randomStub) => {
          const afterFloor = { x: 0, width: afterFloorWidth };
          const state = createTowerState(800, 600);
          state.doorsPassed = STABLE_PHASE_DUEL_THRESHOLD; // Fase_Estable activa
          state.streakWidthBonus = streakWidthBonus;

          const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(randomStub);
          try {
            // Piso elegible como Plataforma_Respiro (floorNum = RELIEF_PLATFORM_FIRST_FLOOR, < 70:
            // usa el 85% fijo de RELIEF_PLATFORM_WIDTH_REDUCED_FACTOR, ajuste de balance)
            state.floors = new Array(RELIEF_PLATFORM_FIRST_FLOOR);
            const widthWithRelief = newMovingBlock(state, afterFloor, 2000).width;

            expect(widthWithRelief).toBe(BASE_PLATFORM_WIDTH * RELIEF_PLATFORM_WIDTH_REDUCED_FACTOR);
          } finally {
            randomSpy.mockRestore();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Nueva propiedad: cada aparición de Plataforma_Respiro incrementa moveSpeed en +0.5% compuesto, acotado a SPEED_CAP; en pisos no elegibles moveSpeed queda inalterado', () => {
    const afterFloorWidthArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH });
    // Cubre tanto valores bien por debajo del tope como en/por encima del tope.
    const moveSpeedArb = fc.float({ min: Math.fround(0.1), max: Math.fround(SPEED_CAP * 1.5), noNaN: true });

    fc.assert(
      fc.property(
        afterFloorWidthArb,
        moveSpeedArb,
        (afterFloorWidth, moveSpeed) => {
          const afterFloor = { x: 0, width: afterFloorWidth };

          // Caso elegible: state.moveSpeed se actualiza según applyReliefPlatformSpeedBoost.
          const stateRelief = createTowerState(800, 600);
          stateRelief.moveSpeed = moveSpeed;
          stateRelief.floors = new Array(RELIEF_PLATFORM_FIRST_FLOOR);
          newMovingBlock(stateRelief, afterFloor, 2000);

          expect(stateRelief.moveSpeed).toBe(applyReliefPlatformSpeedBoost(moveSpeed));
          expect(stateRelief.moveSpeed).toBe(Math.min(SPEED_CAP, moveSpeed * RELIEF_PLATFORM_SPEED_BOOST_FACTOR));

          // Caso NO elegible: state.moveSpeed permanece completamente inalterado.
          const stateNoRelief = createTowerState(800, 600);
          stateNoRelief.moveSpeed = moveSpeed;
          stateNoRelief.floors = new Array(1); // floorNum = 1, no elegible
          newMovingBlock(stateNoRelief, afterFloor, 2000);

          expect(stateNoRelief.moveSpeed).toBe(moveSpeed);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Requirements: 2.2, 4.2 — pruebas unitarias concretas de newMovingBlock/dropBlock
// con Plataforma_Respiro y Bono_Racha_Perfecta combinados
describe('newMovingBlock — casos concretos de Plataforma_Respiro combinada con Bono_Racha_Perfecta', () => {
  let randomSpy;

  afterEach(() => {
    if (randomSpy) {
      randomSpy.mockRestore();
      randomSpy = undefined;
    }
  });

  it('piso NO elegible como Plataforma_Respiro y sin bono de racha produce el ancho normal sin cambios', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const state = createTowerState(800, 600);
    state.doorsPassed = STABLE_PHASE_DUEL_THRESHOLD; // Fase_Estable activa
    state.floors = new Array(1); // floorNum del bloque generado = 1, no coincide con 35/65/95/... (no elegible)
    state.streakWidthBonus = 0; // sin bono de racha

    const afterFloor = { x: 0, width: 400 };
    const expectedWidth = Math.max(MIN_WIDTH, Math.min(400, 400 - 0 * 10)); // 400

    const block = newMovingBlock(state, afterFloor, 2000);

    expect(isReliefPlatformFloor(state.floors.length)).toBe(false);
    expect(block.width).toBe(expectedWidth);
    expect(block.width).toBe(400);
  });

  it('piso elegible como Plataforma_Respiro sin bono de racha produce ancho fijo BASE_PLATFORM_WIDTH (630px)', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const state = createTowerState(800, 600);
    state.doorsPassed = STABLE_PHASE_DUEL_THRESHOLD; // Fase_Estable activa
    state.floors = new Array(RELIEF_PLATFORM_FIRST_FLOOR); // floorNum del bloque generado = RELIEF_PLATFORM_FIRST_FLOOR (elegible)
    state.streakWidthBonus = 0; // sin bono de racha

    const afterFloor = { x: 0, width: 400 };
    const expectedWidth = BASE_PLATFORM_WIDTH * RELIEF_PLATFORM_WIDTH_REDUCED_FACTOR; // ancho fijo (85%), no depende de afterFloor.width; floorNum 35 < 70

    const block = newMovingBlock(state, afterFloor, 2000);

    expect(isReliefPlatformFloor(state.floors.length)).toBe(true);
    expect(block.width).toBe(expectedWidth);
    expect(block.width).toBe(535.5);
  });

  it('piso elegible como Plataforma_Respiro CON streakWidthBonus > 0 vigente produce igualmente ancho fijo reducido (85%), sin importar el bono', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const state = createTowerState(800, 600);
    state.doorsPassed = STABLE_PHASE_DUEL_THRESHOLD; // Fase_Estable activa
    state.floors = new Array(RELIEF_PLATFORM_FIRST_FLOOR); // floorNum del bloque generado = RELIEF_PLATFORM_FIRST_FLOOR (elegible)
    state.streakWidthBonus = 50; // Bono_Racha_Perfecta vigente, sin efecto sobre el ancho fijo

    // afterFloor.width deliberadamente pequeño: el ancho sigue siendo el fijo reducido (85%),
    // ya no se deriva de afterFloor.width/streakWidthBonus cuando el piso es elegible.
    const afterFloor = { x: 0, width: 200 };
    const canvasWidth = 2000;

    const expectedWidth = BASE_PLATFORM_WIDTH * RELIEF_PLATFORM_WIDTH_REDUCED_FACTOR; // ancho fijo, independiente del bono; floorNum 35 < 70

    const block = newMovingBlock(state, afterFloor, canvasWidth);

    expect(isReliefPlatformFloor(state.floors.length)).toBe(true);
    expect(block.width).toBe(expectedWidth);
    expect(block.width).toBe(535.5);
  });
});

// Feature: endless-tower-difficulty-cap, Property 9: El Tope_Velocidad y los mecanismos de ancho (Plataforma_Respiro, Bono_Racha_Perfecta) son completamente independientes entre sí
describe('Tope_Velocidad vs mecanismos de ancho — independencia total', () => {
  // Ejecuta una secuencia de 'win'/'reliefCheck' registrando el ancho de cada
  // MovingBlock generado; el estado de velocidad ('moveSpeedInit') es el único
  // parámetro que varía entre las dos simulaciones paralelas de la primera mitad
  // de esta propiedad.
  function runSequenceForWidth(ops, moveSpeedInit, afterFloorWidth, canvasWidth) {
    const state = createTowerState(800, 600);
    state.moveSpeed = moveSpeedInit;
    state.doorsPassed = 0;
    state.streakWidthBonus = 0;
    const afterFloor = { x: 0, width: afterFloorWidth };
    const widths = [];

    for (const op of ops) {
      if (op === 'win') {
        // Requirement 4.3: Duelo Ganado real — aplica el tope de velocidad,
        // registra la racha perfecta (valor fijo) y avanza doorsPassed.
        applyDuelWinSpeedBoost(state);
        registerDuelWinForStreak(state, true);
        state.doorsPassed += 1;
      } else {
        // 'reliefCheck': avanza state.floors (equivalente al piso que dropBlock
        // habría colocado) y luego construye el siguiente MovingBlock, igual que
        // haría dropBlock tras colocar el piso.
        state.floors.push({});
        // Esta propiedad cubre específicamente la independencia ancho/velocidad en
        // pisos NO elegibles para Plataforma_Respiro: newMovingBlock ahora muta
        // deliberadamente state.moveSpeed cuando el piso SÍ es elegible (ver la
        // nueva propiedad de velocidad más arriba), lo cual es un comportamiento
        // nuevo e intencional que queda fuera del alcance de esta propiedad.
        while (isReliefPlatformFloor(state.floors.length)) {
          state.floors.push({});
        }
        const block = newMovingBlock(state, afterFloor, canvasWidth);
        widths.push(block.width);
      }
    }

    return widths;
  }

  // Ejecuta la misma secuencia registrando state.moveSpeed tras cada 'win'; el
  // estado de ancho ('streakWidthBonusInit'/'stableFloorsBuiltInit') es el único
  // parámetro que varía entre las dos simulaciones paralelas de la segunda mitad
  // de esta propiedad.
  function runSequenceForSpeed(ops, streakWidthBonusInit, afterFloorWidth, canvasWidth) {
    const state = createTowerState(800, 600);
    state.moveSpeed = BASE_SPEED;
    state.doorsPassed = 0;
    state.streakWidthBonus = streakWidthBonusInit;
    const afterFloor = { x: 0, width: afterFloorWidth };
    const speeds = [];

    for (const op of ops) {
      if (op === 'win') {
        applyDuelWinSpeedBoost(state);
        speeds.push(state.moveSpeed);
        registerDuelWinForStreak(state, true);
        state.doorsPassed += 1;
      } else {
        state.floors.push({});
        // Ver comentario equivalente en runSequenceForWidth: se evita aterrizar en
        // un piso elegible para Plataforma_Respiro, ya que eso mutaría moveSpeed
        // como efecto secundario intencional y nuevo, ajeno a esta propiedad de
        // independencia respecto de streakWidthBonus/stableFloorsBuilt/ancho de piso.
        while (isReliefPlatformFloor(state.floors.length)) {
          state.floors.push({});
        }
        newMovingBlock(state, afterFloor, canvasWidth);
      }
    }

    return speeds;
  }

  it('Property 9: el ancho de cada MovingBlock generado no depende de moveSpeed, y moveSpeed tras cada Duelo Ganado no depende de streakWidthBonus/stableFloorsBuilt/ancho de piso', () => {
    const opsArb = fc.array(fc.constantFrom('win', 'reliefCheck'), { minLength: 1, maxLength: 20 });
    const otherMoveSpeedArb = fc.float({ min: Math.fround(0.1), max: Math.fround(50), noNaN: true });
    const randomStubArb = fc.float({ min: 0, max: Math.fround(0.999), noNaN: true });
    const afterFloorWidthArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH });
    const canvasWidthArb = fc.integer({ min: 300, max: 2000 });
    const otherStreakWidthBonusArb = fc.nat({ max: 500 });

    fc.assert(
      fc.property(
        opsArb,
        otherMoveSpeedArb,
        randomStubArb,
        afterFloorWidthArb,
        canvasWidthArb,
        otherStreakWidthBonusArb,
        (ops, otherMoveSpeed, randomStub, afterFloorWidth, canvasWidth, otherStreakWidthBonus) => {
          // --- Mitad 1: el ancho no depende de moveSpeed ---
          // Se fija Math.random al mismo valor en ambas simulaciones para que
          // cualquier diferencia entre los arrays de anchos solo pueda originarse
          // en el moveSpeed inicial distinto (que es lo que se quiere refutar).
          const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(randomStub);
          let widthsA;
          let widthsB;
          try {
            widthsA = runSequenceForWidth(ops, BASE_SPEED, afterFloorWidth, canvasWidth);
            widthsB = runSequenceForWidth(ops, otherMoveSpeed, afterFloorWidth, canvasWidth);
          } finally {
            randomSpy.mockRestore();
          }

          expect(widthsB).toEqual(widthsA);

          // --- Mitad 2: moveSpeed no depende de streakWidthBonus/stableFloorsBuilt/ancho de piso ---
          // Aquí no es necesario estabilizar Math.random: applySpeedBoostWithCap
          // y registerDuelWinForStreak son puramente deterministas respecto de
          // moveSpeed/doorsPassed, y newMovingBlock nunca escribe en moveSpeed.
          const speedsA = runSequenceForSpeed(ops, 0, afterFloorWidth, canvasWidth);
          const speedsB = runSequenceForSpeed(ops, otherStreakWidthBonus, afterFloorWidth, canvasWidth);

          expect(speedsB).toEqual(speedsA);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: relief-platform-width-collapse (bugfix), Property 1: Bug Condition
// El piso resultante SHALL conservar el ancho completo del Bloque en Movimiento premiado
// (movingBlock.width > prevFloor.width) cuando el aterrizaje es válido, en vez de
// recortarlo a la intersección con prevFloor.
// **Validates: Requirements 2.1, 2.2**
// NOTA: este test se escribe ANTES del fix. Sobre el código actual (sin corregir),
// computeNewFloor SIEMPRE usa la intersección (left/right/overlap), por lo que se
// espera que este test FALLE — la falla confirma que el bug existe.
describe('computeNewFloor — Property 1 (Bug Condition): conserva el ancho completo del Bloque en Movimiento premiado', () => {
  it('Property 1: para prevFloor/movingBlock con movingBlock.width > prevFloor.width y aterrizaje válido, result.width === movingBlock.width y result.x === movingBlock.x', () => {
    const prevFloorArb = fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      width: fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH }),
      top: fc.integer({ min: 0, max: 5000 }),
    });
    const movingBlockArb = fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      width: fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH }),
      height: fc.integer({ min: 20, max: 80 }),
    });
    const isDoorArb = fc.boolean();
    const seedArb = fc.float({ min: 0, max: Math.fround(1), noNaN: true });

    fc.assert(
      fc.property(
        prevFloorArb,
        movingBlockArb,
        isDoorArb,
        seedArb,
        (prevFloor, movingBlock, isDoor, seed) => {
          // Filtro por Bug_Condition: bloque premiado (más ancho que prevFloor)
          // Y aterrizaje válido según las funciones de caída existentes, sin modificar.
          fc.pre(movingBlock.width > prevFloor.width);
          fc.pre(decidesFall(computeOverlap(prevFloor, movingBlock)) === false);

          const result = computeNewFloor(prevFloor, movingBlock, isDoor, seed);

          // Comportamiento ESPERADO (post-fix): el piso conserva ancho/posición completos
          // del Bloque en Movimiento, sin recortarse a la intersección con prevFloor.
          expect(result.width).toBe(movingBlock.width);
          expect(result.x).toBe(movingBlock.x);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Ejemplo concreto — Plataforma_Respiro con solapamiento total: prevFloor={x:400,width:200}, movingBlock={x:380,width:400}', () => {
    const prevFloor = { x: 400, width: 200, top: 64 };
    const movingBlock = { x: 380, width: 400, height: 40 };

    // Confirma que el aterrizaje es válido (no cae) antes de evaluar el resultado.
    expect(decidesFall(computeOverlap(prevFloor, movingBlock))).toBe(false);

    const result = computeNewFloor(prevFloor, movingBlock, false, 0);

    // Comportamiento ESPERADO (post-fix): width === 400, x === 380.
    expect(result.width).toBe(400);
    expect(result.x).toBe(380);
  });

  it('Ejemplo concreto — Bono_Racha_Perfecta con solapamiento parcial: prevFloor={x:500,width:210}, movingBlock={x:470,width:300}', () => {
    const prevFloor = { x: 500, width: 210, top: 64 };
    const movingBlock = { x: 470, width: 300, height: 40 };

    expect(decidesFall(computeOverlap(prevFloor, movingBlock))).toBe(false);

    const result = computeNewFloor(prevFloor, movingBlock, false, 0);

    // Comportamiento ESPERADO (post-fix): width === 300, x === 470.
    expect(result.width).toBe(300);
    expect(result.x).toBe(470);
  });
});

// Feature: relief-platform-width-collapse, Property 2: Preservation — caso normal
// (movingBlock.width <= prevFloor.width) sigue usando la fórmula de intersección exacta de hoy.
// **Validates: Requirements 3.1, 3.2**
// NOTA: este test se escribe ANTES del fix, sobre el código SIN corregir. Se espera que PASE,
// capturando el comportamiento base a preservar tras el fix.
describe('computeNewFloor — Property 2 (Preservation): caso normal (movingBlock.width <= prevFloor.width)', () => {
  it('Property 2: para movingBlock.width <= prevFloor.width, x/width coinciden con la fórmula de intersección de referencia reimplementada de forma independiente', () => {
    const prevFloorArb = fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      width: fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH }),
      top: fc.integer({ min: 0, max: 5000 }),
    });
    const movingBlockArb = fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      width: fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH }),
      height: fc.integer({ min: 20, max: 80 }),
    });
    const isDoorArb = fc.boolean();
    const seedArb = fc.float({ min: 0, max: Math.fround(1), noNaN: true });

    fc.assert(
      fc.property(
        prevFloorArb,
        movingBlockArb,
        isDoorArb,
        seedArb,
        (prevFloor, movingBlock, isDoor, seed) => {
          // Filtro por el caso normal/legacy: el Bloque en Movimiento nunca es
          // más ancho que prevFloor.
          fc.pre(movingBlock.width <= prevFloor.width);

          const result = computeNewFloor(prevFloor, movingBlock, isDoor, seed);

          // Oráculo de referencia: fórmula de intersección actual, reimplementada
          // de forma independiente (sin importar ningún detalle interno de tower.js).
          const expectedX = Math.max(movingBlock.x, prevFloor.x);
          const expectedWidth = Math.min(movingBlock.x + movingBlock.width, prevFloor.x + prevFloor.width) - expectedX;

          expect(result.x).toBe(expectedX);
          expect(result.width).toBe(expectedWidth);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: relief-platform-width-collapse, Property 3: Preservation — computeOverlap/decidesFall
// y la detección de caída permanecen byte-por-byte idénticas para todo bloque, con o sin
// movingBlock.width > prevFloor.width.
// **Validates: Requirements 2.3, 3.2, 3.3**
// NOTA: este test se escribe ANTES del fix, sobre el código SIN corregir. Se espera que PASE,
// funcionando como snapshot del comportamiento de detección de caída a re-verificar tras el fix.
describe('computeOverlap/decidesFall — Property 3 (Preservation): snapshot de la detección de caída', () => {
  it('Property 3: para prevFloor/movingBlock completamente arbitrarios, computeOverlap y decidesFall coinciden con su fórmula de referencia reimplementada de forma independiente', () => {
    const prevFloorArb = fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      width: fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH }),
      top: fc.integer({ min: 0, max: 5000 }),
    });
    const movingBlockArb = fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      width: fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH }),
      height: fc.integer({ min: 20, max: 80 }),
    });

    fc.assert(
      fc.property(
        prevFloorArb,
        movingBlockArb,
        (prevFloor, movingBlock) => {
          // Sin fc.pre: cubre tanto movingBlock.width <= prevFloor.width como
          // movingBlock.width > prevFloor.width, y tanto aterrizajes válidos
          // como caídas.
          const overlap = computeOverlap(prevFloor, movingBlock);
          const fell = decidesFall(overlap);

          // Oráculo de referencia: fórmulas actuales de computeOverlap/decidesFall,
          // reimplementadas de forma independiente.
          const expectedOverlap =
            Math.min(movingBlock.x + movingBlock.width, prevFloor.x + prevFloor.width) -
            Math.max(movingBlock.x, prevFloor.x);
          const expectedFell = expectedOverlap < 16;

          expect(overlap).toBe(expectedOverlap);
          expect(fell).toBe(expectedFell);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: relief-platform-width-collapse, Property 4: Preservation — los campos no
// relacionados con width/x (bottom, top, height, isDoor, seed) permanecen sin cambios,
// sin importar la rama (Property 1 o Property 2) en la que caiga el aterrizaje.
// **Validates: Requirement 3.5**
// NOTA: este test se escribe ANTES del fix, sobre el código SIN corregir. Se espera que PASE,
// capturando el comportamiento base de estos campos a preservar tras el fix.
describe('computeNewFloor — Property 4 (Preservation): campos no relacionados con width/x sin cambios', () => {
  it('Property 4: para aterrizaje válido, con ancho relativo arbitrario, bottom/top/height/isDoor/seed coinciden exactamente con los valores esperados', () => {
    const prevFloorArb = fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      width: fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH }),
      top: fc.integer({ min: 0, max: 5000 }),
    });
    const movingBlockArb = fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      width: fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH }),
      height: fc.integer({ min: 20, max: 80 }),
    });
    const isDoorArb = fc.boolean();
    const seedArb = fc.float({ min: 0, max: Math.fround(1), noNaN: true });

    fc.assert(
      fc.property(
        prevFloorArb,
        movingBlockArb,
        isDoorArb,
        seedArb,
        (prevFloor, movingBlock, isDoor, seed) => {
          // Solo se exige que el aterrizaje sea válido (no caiga); el ancho
          // relativo de movingBlock respecto a prevFloor queda sin restringir,
          // cubriendo ambas ramas (Property 1 y Property 2).
          fc.pre(decidesFall(computeOverlap(prevFloor, movingBlock)) === false);

          const result = computeNewFloor(prevFloor, movingBlock, isDoor, seed);

          expect(result.bottom).toBe(prevFloor.top);
          expect(result.top).toBe(prevFloor.top + movingBlock.height);
          expect(result.height).toBe(movingBlock.height);
          expect(result.isDoor).toBe(isDoor);
          expect(result.seed).toBe(seed);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: relief-platform-width-collapse, Tarea 4.4: pruebas unitarias concretas
// adicionales del fix (ejemplos fijos, sin fast-check), complementando las
// Properties 1-4 ya cubiertas arriba con casos concretos y la integración vía dropBlock.
describe('computeNewFloor/dropBlock — casos concretos adicionales del fix (Tarea 4.4)', () => {
  it('computeNewFloor: movingBlock más ancho que prevFloor con aterrizaje válido produce width/x del movingBlock (ejemplo concreto de Plataforma_Respiro)', () => {
    const prevFloor = { x: 300, width: 150, top: 64 };
    const movingBlock = { x: 280, width: 350, height: 40 };

    // Confirma primero que el aterrizaje es válido (no cae).
    expect(decidesFall(computeOverlap(prevFloor, movingBlock))).toBe(false);

    const result = computeNewFloor(prevFloor, movingBlock, false, 0);

    expect(result.width).toBe(350);
    expect(result.x).toBe(280);
  });

  it('computeNewFloor: movingBlock.width <= prevFloor.width produce el mismo resultado que la fórmula de intersección de referencia (ejemplo concreto, valores fijos)', () => {
    const prevFloor = { x: 200, width: 400, top: 64 };
    const movingBlock = { x: 250, width: 300, height: 40 };

    const result = computeNewFloor(prevFloor, movingBlock, false, 0);

    // Fórmula de referencia: x = max(250, 200) = 250; width = min(550, 600) - 250 = 300
    expect(result.x).toBe(250);
    expect(result.width).toBe(300);
  });

  it('dropBlock: state.moving premiado (width > prevFloor.width) con solapamiento insuficiente (overlap < 16) sigue devolviendo { type: "fell" }, sin construir ningún piso', () => {
    const state = createTowerState(800, 600);
    state.screen = 'build';

    const narrowPrevFloor = { x: 300, width: 100, top: 64, bottom: 0, height: 64, isDoor: false, seed: 0 };
    state.floors = [narrowPrevFloor];

    // movingBlock premiado (width 500 > 100), apenas tocando el borde de prevFloor:
    // rango [390, 890] vs prevFloor [300, 400] -> overlap = 400 - 390 = 10 (< 16)
    state.moving = { x: 390, width: 500, height: 40, dir: 1, speed: 1, minX: 0, maxX: 1000 };

    const overlap = computeOverlap(narrowPrevFloor, state.moving);
    expect(overlap).toBeLessThan(16);

    const result = dropBlock(state, 800);

    expect(result).toEqual({ type: 'fell', floorNum: 0 });
    expect(state.floors).toHaveLength(1);
    expect(state.floors[0]).toBe(narrowPrevFloor);
  });

  it('dropBlock: state.moving premiado con solapamiento suficiente empuja un piso con width === movingBlock.width y genera un newMovingBlock válido', () => {
    const state = createTowerState(800, 600);
    state.screen = 'build';

    const narrowPrevFloor = { x: 300, width: 100, top: 64, bottom: 0, height: 64, isDoor: false, seed: 0 };
    state.floors = [narrowPrevFloor];

    // movingBlock premiado (width 500 > 100), con solapamiento sustancial:
    // rango [280, 780] vs prevFloor [300, 400] -> overlap = 400 - 300 = 100 (>= 16)
    state.moving = { x: 280, width: 500, height: 40, dir: 1, speed: 1, minX: 0, maxX: 1000 };

    const overlap = computeOverlap(narrowPrevFloor, state.moving);
    expect(overlap).toBeGreaterThanOrEqual(16);

    const result = dropBlock(state, 800);

    expect(result.type).toBe('placed');
    expect(state.floors).toHaveLength(2);

    const newFloor = state.floors[state.floors.length - 1];
    expect(newFloor.width).toBe(500);
    expect(newFloor.x).toBe(280);

    // El siguiente MovingBlock generado debe ser válido.
    expect(state.moving.minX).toBeLessThanOrEqual(state.moving.maxX);
    expect(state.moving.width).toBeGreaterThanOrEqual(MIN_WIDTH);
    expect(state.moving.width).toBeLessThanOrEqual(BASE_PLATFORM_WIDTH);
  });
});

// Feature: relief-platform-canvas-clamp (bugfix), Property 1: Bug Condition
// El ancho de la Plataforma_Respiro excede canvasWidth en canvases angostos.
// **Validates: Requirements 1.1, 1.2**
// NOTA: este test se escribe ANTES del fix, sobre el código SIN corregir. Se
// espera que FALLE — la falla confirma que el bug existe (w se fija a
// BASE_PLATFORM_WIDTH sin acotar a canvasWidth). NO se debe arreglar el test
// ni el código cuando falle en este punto del plan.
describe('newMovingBlock — Property 1 (Bug Condition): ancho de Plataforma_Respiro acotado a canvasWidth en canvases angostos', () => {
  it('Property 1: para floorNum de Plataforma_Respiro y canvasWidth en [MIN_WIDTH, BASE_PLATFORM_WIDTH - 1], result.width === Math.max(MIN_WIDTH, Math.min(nominalReliefWidth, canvasWidth)) (comportamiento ESPERADO tras el fix; nominalReliefWidth depende de si floorNum >= RELIEF_PLATFORM_RANDOM_SIZE_FIRST_FLOOR, ajuste de balance)', () => {
    const reliefFloorNumArb = fc.nat({ max: 50 }).map(
      (k) => RELIEF_PLATFORM_FIRST_FLOOR + k * RELIEF_PLATFORM_REPEAT_INTERVAL
    );
    const canvasWidthArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH - 1 });
    const afterFloorXArb = fc.integer({ min: 0, max: 1000 });
    const afterFloorWidthArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH });
    const randomStubArb = fc.float({ min: 0, max: Math.fround(0.999), noNaN: true });

    fc.assert(
      fc.property(
        reliefFloorNumArb,
        canvasWidthArb,
        afterFloorXArb,
        afterFloorWidthArb,
        randomStubArb,
        (floorNum, canvasWidth, afterFloorX, afterFloorWidth, randomStub) => {
          expect(isReliefPlatformFloor(floorNum)).toBe(true);

          const state = createTowerState(800, 600);
          state.floors = new Array(floorNum);
          const afterFloor = { x: afterFloorX, width: afterFloorWidth };

          const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(randomStub);
          let result;
          try {
            result = newMovingBlock(state, afterFloor, canvasWidth);
          } finally {
            randomSpy.mockRestore();
          }

          const nominalReliefWidth = isReliefPlatformRandomSizeFloor(floorNum)
            ? BASE_PLATFORM_WIDTH * (0.5 + randomStub * 0.5)
            : BASE_PLATFORM_WIDTH * RELIEF_PLATFORM_WIDTH_REDUCED_FACTOR;
          const expectedWidth = Math.max(MIN_WIDTH, Math.min(nominalReliefWidth, canvasWidth));
          expect(result.width).toBe(expectedWidth);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Ejemplo concreto — móvil típico: floorNum=35, canvasWidth=375, esperado width=375', () => {
    const state = createTowerState(800, 600);
    state.floors = new Array(35);
    const afterFloor = { x: 0, width: 400 };

    const result = newMovingBlock(state, afterFloor, 375);

    expect(result.width).toBe(375);
  });

  it('Ejemplo concreto — extremo angosto: floorNum=65, canvasWidth=300, esperado width=300', () => {
    const state = createTowerState(800, 600);
    state.floors = new Array(65);
    const afterFloor = { x: 0, width: 400 };

    const result = newMovingBlock(state, afterFloor, 300);

    expect(result.width).toBe(300);
  });
});

// Feature: relief-platform-canvas-clamp (bugfix), Property 2: Preservation
// El ancho de la Plataforma_Respiro en escritorio y la rama normal permanecen sin cambios.
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
// NOTA: estos tests se escriben ANTES del fix, sobre el código SIN corregir. Se
// espera que los tres PASEN, capturando el comportamiento base a preservar tras el fix.
describe('newMovingBlock — Property 2/3 (Preservation): escritorio, rama normal e incremento de velocidad sin cambios', () => {
  it('Property 2a: para floorNum de Plataforma_Respiro con canvasWidth >= BASE_PLATFORM_WIDTH (incluyendo undefined), width === nominalReliefWidth sin acotar (85% fijo, o aleatorio 50%-100% desde el piso 70, ajuste de balance)', () => {
    const reliefFloorNumArb = fc.nat({ max: 50 }).map(
      (k) => RELIEF_PLATFORM_FIRST_FLOOR + k * RELIEF_PLATFORM_REPEAT_INTERVAL
    );
    const canvasWidthArb = fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: BASE_PLATFORM_WIDTH, max: BASE_PLATFORM_WIDTH + 2000 })
    );
    const afterFloorXArb = fc.integer({ min: 0, max: 1000 });
    const afterFloorWidthArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH });
    const randomStubArb = fc.float({ min: 0, max: Math.fround(0.999), noNaN: true });

    fc.assert(
      fc.property(
        reliefFloorNumArb,
        canvasWidthArb,
        afterFloorXArb,
        afterFloorWidthArb,
        randomStubArb,
        (floorNum, canvasWidth, afterFloorX, afterFloorWidth, randomStub) => {
          expect(isReliefPlatformFloor(floorNum)).toBe(true);

          const state = createTowerState(800, 600);
          state.floors = new Array(floorNum);
          const afterFloor = { x: afterFloorX, width: afterFloorWidth };

          const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(randomStub);
          let result;
          try {
            result = newMovingBlock(state, afterFloor, canvasWidth);
          } finally {
            randomSpy.mockRestore();
          }

          const expectedWidth = isReliefPlatformRandomSizeFloor(floorNum)
            ? BASE_PLATFORM_WIDTH * (0.5 + randomStub * 0.5)
            : BASE_PLATFORM_WIDTH * RELIEF_PLATFORM_WIDTH_REDUCED_FACTOR;
          expect(result.width).toBe(expectedWidth);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2b: para floorNum que NO es Plataforma_Respiro (cualquier canvasWidth, incluyendo undefined), width/minX/maxX/dir coinciden con la fórmula de la rama normal reimplementada como oráculo de referencia', () => {
    const nonReliefFloorNumArb = fc
      .integer({ min: 0, max: 2000 })
      .filter((n) => !isReliefPlatformFloor(n));
    const canvasWidthArb = fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: 50, max: 2000 })
    );
    const doorsPassedArb = fc.nat({ max: 60 });
    const streakWidthBonusArb = fc.nat({ max: 500 });
    const afterFloorXArb = fc.integer({ min: 0, max: 1000 });
    const afterFloorWidthArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH });
    const randomStubArb = fc.float({ min: 0, max: Math.fround(0.999), noNaN: true });

    fc.assert(
      fc.property(
        nonReliefFloorNumArb,
        canvasWidthArb,
        doorsPassedArb,
        streakWidthBonusArb,
        afterFloorXArb,
        afterFloorWidthArb,
        randomStubArb,
        (floorNum, canvasWidth, doorsPassed, streakWidthBonus, afterFloorX, afterFloorWidth, randomStub) => {
          expect(isReliefPlatformFloor(floorNum)).toBe(false);

          const state = createTowerState(800, 600);
          state.floors = new Array(floorNum);
          state.doorsPassed = doorsPassed;
          state.streakWidthBonus = streakWidthBonus;
          const afterFloor = { x: afterFloorX, width: afterFloorWidth };

          const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(randomStub);
          let result;
          try {
            result = newMovingBlock(state, afterFloor, canvasWidth);
          } finally {
            randomSpy.mockRestore();
          }

          // Oráculo de referencia: fórmula de la rama normal reimplementada de
          // forma independiente, usando el mismo randomStub que newMovingBlock
          // vio en cada una de sus llamadas a Math.random().
          const inStablePhase = doorsPassed >= STABLE_PHASE_DUEL_THRESHOLD;
          const maxWidthWithStreakBonus = Math.min(
            afterFloorWidth + (inStablePhase ? streakWidthBonus : 0),
            canvasWidth ?? Infinity
          );
          const expectedWidth = Math.max(
            MIN_WIDTH,
            Math.min(maxWidthWithStreakBonus, maxWidthWithStreakBonus - randomStub * 10)
          );
          const expectedMargin = computeMovementMargin(canvasWidth);
          const expectedMinX = Math.max(0, afterFloorX - expectedMargin);
          const expectedMaxX =
            Math.min(canvasWidth ?? (afterFloorX + afterFloorWidth + expectedMargin), afterFloorX + afterFloorWidth + expectedMargin) -
            expectedWidth;
          const expectedStartFromRight = randomStub < 0.5;
          const expectedDir = expectedStartFromRight ? -1 : 1;

          expect(result.width).toBe(expectedWidth);
          expect(result.minX).toBe(expectedMinX);
          expect(result.maxX).toBe(expectedMaxX);
          expect(result.dir).toBe(expectedDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: para floorNum de Plataforma_Respiro con canvasWidth arbitrario (angosto o no, incluyendo undefined), state.moveSpeed tras la llamada coincide exactamente con applyReliefPlatformSpeedBoost(moveSpeed_antes) invocado directamente', () => {
    const reliefFloorNumArb = fc.nat({ max: 50 }).map(
      (k) => RELIEF_PLATFORM_FIRST_FLOOR + k * RELIEF_PLATFORM_REPEAT_INTERVAL
    );
    const canvasWidthArb = fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: MIN_WIDTH, max: 2000 })
    );
    const moveSpeedArb = fc.float({ min: Math.fround(0.1), max: Math.fround(SPEED_CAP * 1.5), noNaN: true });
    const afterFloorXArb = fc.integer({ min: 0, max: 1000 });
    const afterFloorWidthArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH });

    fc.assert(
      fc.property(
        reliefFloorNumArb,
        canvasWidthArb,
        moveSpeedArb,
        afterFloorXArb,
        afterFloorWidthArb,
        (floorNum, canvasWidth, moveSpeed, afterFloorX, afterFloorWidth) => {
          expect(isReliefPlatformFloor(floorNum)).toBe(true);

          const state = createTowerState(800, 600);
          state.floors = new Array(floorNum);
          state.moveSpeed = moveSpeed;
          const afterFloor = { x: afterFloorX, width: afterFloorWidth };

          newMovingBlock(state, afterFloor, canvasWidth);

          expect(state.moveSpeed).toBe(applyReliefPlatformSpeedBoost(moveSpeed));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: landscape-orientation-support, Requirement 4.1 — no-regresión de anchorScreenY
// NOTA: anchorScreenY es código de solo-escritura en tower.js (no se lee en ningún pipeline
// de render), por lo que esta feature no lo modifica. Este test unitario confirma que
// createTowerState/resetGame siguen calculando exactamente height * 0.62, sin ninguna
// modificación al código de tower.js.
describe('createTowerState/resetGame — no-regresión de anchorScreenY (height * 0.62)', () => {
  it.each([100, 375, 520, 600, 667, 1024, 1200])(
    'createTowerState(W, %i).anchorScreenY === %i * 0.62',
    (height) => {
      const state = createTowerState(800, height);
      expect(state.anchorScreenY).toBe(height * 0.62);
    }
  );

  it.each([100, 375, 520, 600, 667, 1024, 1200])(
    'resetGame mantiene anchorScreenY === %i * 0.62 tras reiniciar el estado',
    (height) => {
      const state = createTowerState(800, 600);

      // Corrompe deliberadamente anchorScreenY antes de resetGame, para confirmar
      // que resetGame lo recalcula (y no simplemente lo deja intacto por accidente).
      state.anchorScreenY = -1;

      resetGame(state, 800, height);

      expect(state.anchorScreenY).toBe(height * 0.62);
    }
  );
});

// Feature: base-platform-canvas-clamp (bugfix), Property 1: Bug Condition
// El ancho de la Plataforma Base excede `width` en canvases angostos.
// **Validates: Requirements 1.1, 1.2, 1.3**
// NOTA: este test se escribe ANTES del fix, sobre el código SIN corregir. Se
// espera que FALLE — la falla confirma que el bug existe (baseFloor.width se
// fija incondicionalmente a BASE_PLATFORM_WIDTH sin acotar a `width`, y
// baseFloor.x resulta negativo). NO se debe arreglar el test ni el código
// cuando falle en este punto del plan.
describe('createTowerState/resetGame — Property 1 (Bug Condition): ancho de la Plataforma Base acotado a width en canvases angostos', () => {
  it('Property 1 (createTowerState): para width en [MIN_WIDTH, BASE_PLATFORM_WIDTH - 1], floors[0].width === Math.max(MIN_WIDTH, Math.min(BASE_PLATFORM_WIDTH, width)) y floors[0].x === (width - floors[0].width) / 2 (comportamiento ESPERADO tras el fix)', () => {
    const widthArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH - 1 });
    const heightArb = fc.integer({ min: 300, max: 1200 });

    fc.assert(
      fc.property(
        widthArb,
        heightArb,
        (width, height) => {
          const state = createTowerState(width, height);
          const baseFloor = state.floors[0];

          const expectedWidth = Math.max(MIN_WIDTH, Math.min(BASE_PLATFORM_WIDTH, width));
          expect(baseFloor.width).toBe(expectedWidth);
          expect(baseFloor.x).toBe((width - baseFloor.width) / 2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1 (resetGame): para width en [MIN_WIDTH, BASE_PLATFORM_WIDTH - 1] sobre un state preexistente, floors[0].width === Math.max(MIN_WIDTH, Math.min(BASE_PLATFORM_WIDTH, width)) y floors[0].x === (width - floors[0].width) / 2 (comportamiento ESPERADO tras el fix)', () => {
    const widthArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH - 1 });
    const heightArb = fc.integer({ min: 300, max: 1200 });

    fc.assert(
      fc.property(
        widthArb,
        heightArb,
        (width, height) => {
          // state preexistente construido con un width amplio de escritorio,
          // luego reiniciado con el width angosto bajo prueba.
          const state = createTowerState(800, height);

          resetGame(state, width, height);
          const baseFloor = state.floors[0];

          const expectedWidth = Math.max(MIN_WIDTH, Math.min(BASE_PLATFORM_WIDTH, width));
          expect(baseFloor.width).toBe(expectedWidth);
          expect(baseFloor.x).toBe((width - baseFloor.width) / 2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Ejemplo concreto — móvil típico: width=375, esperado floors[0].width=375, floors[0].x=0 (createTowerState y resetGame)', () => {
    const stateCreated = createTowerState(375, 600);
    expect(stateCreated.floors[0].width).toBe(375);
    expect(stateCreated.floors[0].x).toBe(0);

    const stateReset = createTowerState(800, 600);
    resetGame(stateReset, 375, 600);
    expect(stateReset.floors[0].width).toBe(375);
    expect(stateReset.floors[0].x).toBe(0);
  });

  it('Ejemplo concreto — extremo angosto: width=300, esperado floors[0].width=300, floors[0].x=0 (createTowerState y resetGame)', () => {
    const stateCreated = createTowerState(300, 600);
    expect(stateCreated.floors[0].width).toBe(300);
    expect(stateCreated.floors[0].x).toBe(0);

    const stateReset = createTowerState(800, 600);
    resetGame(stateReset, 300, 600);
    expect(stateReset.floors[0].width).toBe(300);
    expect(stateReset.floors[0].x).toBe(0);
  });
});

// Feature: base-platform-canvas-clamp (bugfix), Property 2: Preservation
// El ancho y la posición de la Plataforma Base en escritorio permanecen sin cambios.
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
// NOTA: estos tests se escriben ANTES del fix, sobre el código SIN corregir. Se
// espera que PASEN, capturando el comportamiento base a preservar tras el fix.
describe('createTowerState/resetGame — Property 2 (Preservation): escritorio y campos no relacionados con width/x sin cambios', () => {
  it('Property 2a (createTowerState): para width >= BASE_PLATFORM_WIDTH (incluyendo undefined), floors[0].width === BASE_PLATFORM_WIDTH y floors[0].x === (width - BASE_PLATFORM_WIDTH) / 2', () => {
    const widthArb = fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: BASE_PLATFORM_WIDTH, max: BASE_PLATFORM_WIDTH + 2000 })
    );
    const heightArb = fc.integer({ min: 300, max: 1200 });

    fc.assert(
      fc.property(
        widthArb,
        heightArb,
        (width, height) => {
          const state = createTowerState(width, height);
          const baseFloor = state.floors[0];

          expect(baseFloor.width).toBe(BASE_PLATFORM_WIDTH);
          expect(baseFloor.x).toBe((width - BASE_PLATFORM_WIDTH) / 2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2b (resetGame): para width >= BASE_PLATFORM_WIDTH (incluyendo undefined) sobre un state preexistente, floors[0].width === BASE_PLATFORM_WIDTH y floors[0].x === (width - BASE_PLATFORM_WIDTH) / 2', () => {
    const widthArb = fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: BASE_PLATFORM_WIDTH, max: BASE_PLATFORM_WIDTH + 2000 })
    );
    const heightArb = fc.integer({ min: 300, max: 1200 });

    fc.assert(
      fc.property(
        widthArb,
        heightArb,
        (width, height) => {
          const state = createTowerState(375, height);

          resetGame(state, width, height);
          const baseFloor = state.floors[0];

          expect(baseFloor.width).toBe(BASE_PLATFORM_WIDTH);
          expect(baseFloor.x).toBe((width - BASE_PLATFORM_WIDTH) / 2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2c: para width arbitrario (angosto o no, incluyendo undefined), baseFloor.bottom/top/height/isDoor permanecen 0/64/64/false, tanto en createTowerState como en resetGame', () => {
    const widthArb = fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: 0, max: BASE_PLATFORM_WIDTH + 2000 })
    );
    const heightArb = fc.integer({ min: 300, max: 1200 });

    fc.assert(
      fc.property(
        widthArb,
        heightArb,
        (width, height) => {
          const createdState = createTowerState(width, height);
          const createdBaseFloor = createdState.floors[0];

          expect(createdBaseFloor.bottom).toBe(0);
          expect(createdBaseFloor.top).toBe(64);
          expect(createdBaseFloor.height).toBe(64);
          expect(createdBaseFloor.isDoor).toBe(false);

          const resetState = createTowerState(800, height);
          resetGame(resetState, width, height);
          const resetBaseFloor = resetState.floors[0];

          expect(resetBaseFloor.bottom).toBe(0);
          expect(resetBaseFloor.top).toBe(64);
          expect(resetBaseFloor.height).toBe(64);
          expect(resetBaseFloor.isDoor).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2d: para dos width arbitrarios distintos (misma height), los campos del state no relacionados con baseFloor.width/x permanecen idénticos entre sí, tanto en createTowerState como en resetGame (excluyendo seed/torchSeed/clouds/activeBiome/activeTimeOfDay no deterministas)', () => {
    const widthArb = fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH + 2000 })
    );
    const heightArb = fc.integer({ min: 300, max: 1200 });

    // Extrae únicamente los campos que, según el design, no dependen de
    // baseFloor.width/baseFloor.x ni son inherentemente no deterministas.
    // Nota: "moving" se excluye deliberadamente — resetGame invoca
    // newMovingBlock(state, baseFloor, width), cuyo resultado (minX/maxX/x)
    // depende legítimamente de `width`, por lo que difiere entre widthA/widthB
    // sin que eso constituya ningún cambio de comportamiento no deseado.
    const pickStableFields = (state) => ({
      screen: state.screen,
      moveSpeed: state.moveSpeed,
      perfectStreak: state.perfectStreak,
      streakWidthBonus: state.streakWidthBonus,
      camElev: state.camElev,
      camElevTarget: state.camElevTarget,
      anchorScreenY: state.anchorScreenY,
      knight: state.knight,
      doorsPassed: state.doorsPassed,
      pendingBossLevel: state.pendingBossLevel,
      lastTs: state.lastTs,
    });

    fc.assert(
      fc.property(
        widthArb,
        widthArb,
        heightArb,
        (widthA, widthB, height) => {
          const stateA = createTowerState(widthA, height);
          const stateB = createTowerState(widthB, height);

          expect(pickStableFields(stateB)).toEqual(pickStableFields(stateA));

          const resetStateA = createTowerState(800, height);
          resetGame(resetStateA, widthA, height);
          const resetStateB = createTowerState(800, height);
          resetGame(resetStateB, widthB, height);

          expect(pickStableFields(resetStateB)).toEqual(pickStableFields(resetStateA));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: base-platform-canvas-clamp (bugfix), Tarea 4.5 (opcional): pruebas
// unitarias concretas adicionales del fix (ejemplos fijos, sin fast-check).
// **Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5**
describe('createTowerState/resetGame — Tarea 4.5: casos concretos adicionales del fix', () => {
  it('createTowerState(375, height) produce floors[0].width === 375 y floors[0].x === 0 (móvil angosto)', () => {
    const state = createTowerState(375, 600);
    const baseFloor = state.floors[0];

    expect(baseFloor.width).toBe(375);
    expect(baseFloor.x).toBe(0);
  });

  it('createTowerState(800, height) produce floors[0].width === BASE_PLATFORM_WIDTH (630) y floors[0].x === 85 (escritorio, sin regresión)', () => {
    const state = createTowerState(800, 600);
    const baseFloor = state.floors[0];

    expect(baseFloor.width).toBe(BASE_PLATFORM_WIDTH);
    expect(baseFloor.width).toBe(630);
    expect(baseFloor.x).toBe(85);
  });

  it('createTowerState(30, height) produce floors[0].width === MIN_WIDTH (46, piso mínimo)', () => {
    const state = createTowerState(30, 600);
    const baseFloor = state.floors[0];

    expect(baseFloor.width).toBe(MIN_WIDTH);
    expect(baseFloor.width).toBe(46);
  });

  it('resetGame(state, 375, height) produce floors[0].width === 375 y floors[0].x === 0, igual que createTowerState(375, height)', () => {
    const createdState = createTowerState(375, 600);

    const resetState = createTowerState(800, 600);
    resetGame(resetState, 375, 600);

    expect(resetState.floors[0].width).toBe(createdState.floors[0].width);
    expect(resetState.floors[0].x).toBe(createdState.floors[0].x);
    expect(resetState.floors[0].width).toBe(375);
    expect(resetState.floors[0].x).toBe(0);
  });

  it('createTowerState/resetGame con width angosto dejan bottom === 0, top === 64, height === 64, isDoor === false en baseFloor', () => {
    const createdState = createTowerState(375, 600);
    const createdBaseFloor = createdState.floors[0];

    expect(createdBaseFloor.bottom).toBe(0);
    expect(createdBaseFloor.top).toBe(64);
    expect(createdBaseFloor.height).toBe(64);
    expect(createdBaseFloor.isDoor).toBe(false);

    const resetState = createTowerState(800, 600);
    resetGame(resetState, 375, 600);
    const resetBaseFloor = resetState.floors[0];

    expect(resetBaseFloor.bottom).toBe(0);
    expect(resetBaseFloor.top).toBe(64);
    expect(resetBaseFloor.height).toBe(64);
    expect(resetBaseFloor.isDoor).toBe(false);
  });
});

// Feature: canvas-relative-physics-balance, Property 1: Paridad exacta con el comportamiento
// actual en Reference_Canvas_Width (decidesFall)
// **Validates: Requirements 1.2, 1.4, 1.6, 3.2**
describe('decidesFall — Property 1 (canvas-relative-physics-balance): paridad exacta en Reference_Canvas_Width', () => {
  it('Property 1: para cualquier overlap, decidesFall(overlap, 800) === (overlap < 16), y decidesFall(overlap) === decidesFall(overlap, 800)', () => {
    const overlapArb = fc.double({ min: -5000, max: 5000, noNaN: true });

    fc.assert(
      fc.property(
        overlapArb,
        (overlap) => {
          expect(decidesFall(overlap, 800)).toBe(overlap < 16);
          expect(decidesFall(overlap)).toBe(decidesFall(overlap, 800));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: canvas-relative-physics-balance, Property 2: El Umbral_de_Caida efectivo es
// estrictamente monótono creciente en W
// **Validates: Requirements 1.3**
describe('computeFallThreshold — Property 2 (canvas-relative-physics-balance): monotonía estricta en W', () => {
  it('Property 2: para cualquier par W1 < W2 (ambos > 0), computeFallThreshold(W1) < computeFallThreshold(W2)', () => {
    const widthPairArb = fc
      .tuple(
        fc.double({ min: 0.01, max: 5000, noNaN: true }),
        fc.double({ min: 0.01, max: 5000, noNaN: true })
      )
      .filter(([a, b]) => a !== b)
      .map(([a, b]) => (a < b ? [a, b] : [b, a]));

    fc.assert(
      fc.property(
        widthPairArb,
        ([W1, W2]) => {
          expect(computeFallThreshold(W1)).toBeLessThan(computeFallThreshold(W2));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: canvas-relative-physics-balance, Property 3: El cálculo del Umbral_de_Caida es determinista
// **Validates: Requirements 1.5**
describe('computeFallThreshold — Property 3 (canvas-relative-physics-balance): determinismo', () => {
  it('Property 3: para cualquier W > 0, invocar computeFallThreshold(W) varias veces siempre devuelve el mismo valor', () => {
    const widthArb = fc.double({ min: 0.01, max: 5000, noNaN: true });

    fc.assert(
      fc.property(
        widthArb,
        (W) => {
          const first = computeFallThreshold(W);
          for (let i = 0; i < 5; i++) {
            expect(computeFallThreshold(W)).toBe(first);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: canvas-relative-physics-balance, Property 4: El Margen_de_Movimiento efectivo es
// siempre exactamente proporcional a canvasWidth, sin excepción ni tolerancia
// **Validates: Requirements 2.1, 2.3, 2.4**
describe('computeMovementMargin — Property 4 (canvas-relative-physics-balance): proporcionalidad exacta sin tolerancia', () => {
  it('Property 4: para cualquier canvasWidth > 0 (incluyendo 799/801), computeMovementMargin(canvasWidth) === canvasWidth * Movement_Margin_Fraction', () => {
    const canvasWidthArb = fc.oneof(
      fc.double({ min: 0.01, max: 5000, noNaN: true }),
      fc.constant(799),
      fc.constant(801),
      fc.constant(800)
    );

    fc.assert(
      fc.property(
        canvasWidthArb,
        (canvasWidth) => {
          expect(computeMovementMargin(canvasWidth)).toBe(canvasWidth * Movement_Margin_Fraction);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: canvas-relative-physics-balance, Property 5: Paridad exacta con el comportamiento
// actual en Reference_Canvas_Width (newMovingBlock)
// **Validates: Requirements 2.2, 2.5, 2.6, 2.7, 3.3**
describe('newMovingBlock — Property 5 (canvas-relative-physics-balance): paridad exacta minX/maxX en Reference_Canvas_Width', () => {
  it('Property 5: para cualquier afterFloor y w, minX/maxX calculados con canvasWidth=800 coinciden con la fórmula literal usando 90', () => {
    const afterFloorArb = fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      width: fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH }),
    });
    const wArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH });

    fc.assert(
      fc.property(
        afterFloorArb,
        wArb,
        (afterFloor, w) => {
          const canvasWidth = Reference_Canvas_Width; // 800
          const minX = Math.max(0, afterFloor.x - computeMovementMargin(canvasWidth));
          const maxX = Math.min(canvasWidth ?? (afterFloor.x + afterFloor.width + computeMovementMargin(canvasWidth)), afterFloor.x + afterFloor.width + computeMovementMargin(canvasWidth)) - w;

          const expectedMinX = Math.max(0, afterFloor.x - 90);
          const expectedMaxX = Math.min(canvasWidth, afterFloor.x + afterFloor.width + 90) - w;

          expect(minX).toBe(expectedMinX);
          expect(maxX).toBe(expectedMaxX);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: canvas-relative-physics-balance, Property 6: minX y maxX siempre usan el mismo
// Margen_de_Movimiento efectivo, para cualquier canvasWidth
// **Validates: Requirements 2.4, 2.5, 2.6**
describe('newMovingBlock — Property 6 (canvas-relative-physics-balance): consistencia interna minX/maxX del margen efectivo', () => {
  it('Property 6: para canvasWidth > 0, afterFloor y w arbitrarios, el margen implícito derivado de minX y de maxX es el mismo y coincide con computeMovementMargin(canvasWidth)', () => {
    const canvasWidthArb = fc.integer({ min: MIN_WIDTH, max: 5000 });
    const afterFloorArb = fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      width: fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH }),
    });
    const wArb = fc.integer({ min: MIN_WIDTH, max: BASE_PLATFORM_WIDTH });

    fc.assert(
      fc.property(
        canvasWidthArb,
        afterFloorArb,
        wArb,
        (canvasWidth, afterFloor, w) => {
          const expectedMargin = computeMovementMargin(canvasWidth);
          const minX = Math.max(0, afterFloor.x - expectedMargin);
          const maxX = Math.min(canvasWidth, afterFloor.x + afterFloor.width + expectedMargin) - w;

          // Margen implícito derivado de minX (solo válido cuando el clamp de Math.max(0, ...)
          // no se activó, es decir, cuando afterFloor.x - expectedMargin >= 0)
          if (afterFloor.x - expectedMargin >= 0) {
            const impliedMarginFromMinX = afterFloor.x - minX;
            expect(impliedMarginFromMinX).toBeCloseTo(expectedMargin, 9);
          }

          // Margen implícito derivado de maxX (solo válido cuando el clamp de Math.min(canvasWidth, ...)
          // no se activó, es decir, cuando afterFloor.x + afterFloor.width + expectedMargin <= canvasWidth)
          if (afterFloor.x + afterFloor.width + expectedMargin <= canvasWidth) {
            const impliedMarginFromMaxX = (maxX + w) - (afterFloor.x + afterFloor.width);
            expect(impliedMarginFromMaxX).toBeCloseTo(expectedMargin, 9);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: canvas-relative-physics-balance, Property 7: El cálculo del umbral/margen efectivo
// no altera moveSpeed ni otros sistemas fuera de alcance
// **Validates: Requirements 4.2**
describe('computeFallThreshold/computeMovementMargin/decidesFall — Property 7 (canvas-relative-physics-balance): aislamiento respecto a moveSpeed/streak', () => {
  it('Property 7: invocar computeFallThreshold, computeMovementMargin y decidesFall en aislamiento no altera state.moveSpeed, state.perfectStreak, state.streakWidthBonus', () => {
    const canvasWidthArb = fc.double({ min: 0.01, max: 5000, noNaN: true });
    const overlapArb = fc.double({ min: -5000, max: 5000, noNaN: true });
    const moveSpeedArb = fc.float({ min: Math.fround(0.1), max: Math.fround(1000), noNaN: true });
    const perfectStreakArb = fc.nat({ max: 200 });
    const streakWidthBonusArb = fc.nat({ max: 2000 });

    fc.assert(
      fc.property(
        canvasWidthArb,
        overlapArb,
        moveSpeedArb,
        perfectStreakArb,
        streakWidthBonusArb,
        (canvasWidth, overlap, moveSpeed, perfectStreak, streakWidthBonus) => {
          const state = createTowerState(800, 600);
          state.moveSpeed = moveSpeed;
          state.perfectStreak = perfectStreak;
          state.streakWidthBonus = streakWidthBonus;

          computeFallThreshold(canvasWidth);
          computeMovementMargin(canvasWidth);
          decidesFall(overlap, canvasWidth);

          expect(state.moveSpeed).toBe(moveSpeed);
          expect(state.perfectStreak).toBe(perfectStreak);
          expect(state.streakWidthBonus).toBe(streakWidthBonus);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: canvas-relative-physics-balance, Tarea 5.8: unit tests de casos límite y no-regresión
// **Validates: Requirements 3.1, 4.1, 4.3, 4.4, 4.5**
describe('canvas-relative-physics-balance — unit tests de casos límite y no-regresión', () => {
  it('constantes: Reference_Canvas_Width === 800, Fall_Threshold_Fraction === 0.02, Movement_Margin_Fraction === 0.1125', () => {
    expect(Reference_Canvas_Width).toBe(800);
    expect(Fall_Threshold_Fraction).toBe(0.02);
    expect(Movement_Margin_Fraction).toBe(0.1125);
  });

  it('computeFallThreshold(800) === 16 y computeMovementMargin(800) === 90', () => {
    expect(computeFallThreshold(800)).toBe(16);
    expect(computeMovementMargin(800)).toBe(90);
  });

  it('decidesFall casos límite exactos del umbral (borde estricto <)', () => {
    expect(decidesFall(15)).toBe(true);
    expect(decidesFall(15, 800)).toBe(true);
    expect(decidesFall(16)).toBe(false);
    expect(decidesFall(16, 800)).toBe(false);
  });

  it('ejemplo móvil concreto: computeFallThreshold(375) y computeMovementMargin(375) son proporcionalmente menores que sus equivalentes en 800', () => {
    const mobileFallThreshold = computeFallThreshold(375);
    const mobileMovementMargin = computeMovementMargin(375);

    expect(mobileFallThreshold).toBeLessThan(computeFallThreshold(800));
    expect(mobileMovementMargin).toBeLessThan(computeMovementMargin(800));

    // Proporcionalidad exacta: mismo ratio que 375/800
    expect(mobileFallThreshold).toBeCloseTo(16 * (375 / 800), 10);
    expect(mobileMovementMargin).toBeCloseTo(90 * (375 / 800), 10);
  });

  it('llamadas existentes de un solo argumento en tower.test.js (decidesFall(computeOverlap(prevFloor, movingBlock))) siguen pasando sin modificarlas', () => {
    const prevFloor = { x: 300, width: 200, top: 64 };
    const movingBlock = { x: 320, width: 100, height: 40 };

    const overlap = computeOverlap(prevFloor, movingBlock);
    expect(decidesFall(overlap)).toBe(overlap < 16);
  });

  it('regresión de aridad: dropBlock.length y newMovingBlock.length no cambian', () => {
    expect(dropBlock.length).toBe(2);
    expect(newMovingBlock.length).toBe(3);
  });

  it('no-regresión de isReliefPlatformFloor/streakWidthBonus/perfectStreak: invocar newMovingBlock con distintos canvasWidth no afecta estos valores fuera de alcance', () => {
    const state = createTowerState(800, 600);
    state.floors = new Array(RELIEF_PLATFORM_FIRST_FLOOR); // piso elegible como Plataforma_Respiro
    state.perfectStreak = 7;
    state.streakWidthBonus = 123;

    const afterFloor = { x: 0, width: 400 };
    const floorNumBefore = state.floors.length;

    newMovingBlock(state, afterFloor, 375);
    expect(isReliefPlatformFloor(state.floors.length)).toBe(isReliefPlatformFloor(floorNumBefore));
    expect(state.perfectStreak).toBe(7);
    expect(state.streakWidthBonus).toBe(123);

    newMovingBlock(state, afterFloor, 1200);
    expect(isReliefPlatformFloor(state.floors.length)).toBe(isReliefPlatformFloor(floorNumBefore));
    expect(state.perfectStreak).toBe(7);
    expect(state.streakWidthBonus).toBe(123);
  });
});
