import test from 'node:test';
import assert from 'node:assert/strict';
import { validateToolArguments } from '../src/tool-validation.mjs';

test('click 拒绝伪造 hover 参数和缺失/含糊目标，不能静默执行点击', () => {
  const click = { name: 'browser_click', inputSchema: { properties: { ref: { type: 'string' }, selector: { type: 'string' } } } };
  assert.deepEqual(validateToolArguments(click, { ref: 'e11' }), { ref: 'e11' });
  assert.throws(() => validateToolArguments(click, { ref: 'e11', action: 'hover' }), /不支持参数 action/);
  assert.throws(() => validateToolArguments(click, {}), /需要 ref/);
  assert.throws(() => validateToolArguments(click, { ref: 'e11', selector: 'button' }), /只能提供一个/);
  assert.throws(() => validateToolArguments(click, { ref: 11 }), /string/);
});
