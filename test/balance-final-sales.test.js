import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateStation } from '../src/engine.js';

test('module-target station sells every selected final ware net output independently of legacy ratios', () => {
  const catalog = { rawWares: [], workforceConsumption: {}, recipes: {
    Alpha: { cycleSeconds: 3600, outputs: { Alpha: 1 }, inputs: {}, workforce: 0, buildCost: 1 },
    Beta: { cycleSeconds: 3600, outputs: { Beta: 1 }, inputs: {}, workforce: 0, buildCost: 1 },
    AlloyPlant: { cycleSeconds: 3600, outputs: { Alloy: 1 }, inputs: {}, workforce: 0, buildCost: 1 },
    SparePart: { cycleSeconds: 3600, outputs: { SparePart: 1 }, inputs: { Alloy: 1 }, workforce: 0, buildCost: 1 },
  } };
  const station = {
    modules: { Alpha: 3, Beta: 1, AlloyPlant: 2 }, sunlight: 1, availableWorkforce: 0,
    prices: { Alpha: 10, Beta: 20, Alloy: 100 },
    finalWares: { Alpha: 1, Beta: 1 }, targetCounts: { Alpha: 3, Beta: 1 },
    purchasedIntermediates: [], sellIntermediateSurplus: false,
  };

  const calculation = calculateStation({ station, catalog });
  assert.deepEqual(calculation.finalOutput, { Alpha: 3, Beta: 1 });
  assert.deepEqual(calculation.surplusSales, {});
  assert.equal(calculation.balance.Alloy, 2);
  assert.equal(calculation.hourlyRevenue, 50, 'Alloy remains unsold while surplus sales are off');
});
