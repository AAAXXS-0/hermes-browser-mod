// The low-level MCP SDK validates the request envelope, not each tool's input
// schema. Validate the public arguments before reaching the browser service.
export function validateToolArguments(tool, args = {}) {
  if (!tool) throw new Error('工具不存在，请使用实际列出的 MCP 工具');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象');
  const { properties, required = [] } = tool.inputSchema;
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(properties, key)) throw new Error(`${tool.name} 不支持参数 ${key}；不会执行操作。请按工具定义调用。`);
    const schema = properties[key];
    const expectedType = schema.type === 'integer' ? 'number' : schema.type;
    if (typeof args[key] !== expectedType || expectedType === 'number' && !Number.isFinite(args[key]) || schema.type === 'integer' && !Number.isInteger(args[key])) throw new Error(`参数 ${key} 必须是 ${schema.type}`);
    if (schema.type === 'string' && key !== 'text' && !args[key].trim()) throw new Error(`参数 ${key} 不能为空`);
    if (schema.enum && !schema.enum.includes(args[key])) throw new Error(`参数 ${key} 必须是 ${schema.enum.join('、')}`);
    if (schema.maxLength !== undefined && args[key].length > schema.maxLength) throw new Error(`参数 ${key} 最多 ${schema.maxLength} 字符，请分段输入`);
    if (schema.minimum !== undefined && args[key] < schema.minimum || schema.maximum !== undefined && args[key] > schema.maximum) throw new Error(`参数 ${key} 超出允许范围`);
  }
  for (const key of required) if (!Object.hasOwn(args, key)) throw new Error(`缺少参数 ${key}`);
  if (['browser_click', 'browser_fill'].includes(tool.name)) {
    if (!args.ref && !args.selector) throw new Error('需要 ref 或 selector，请先读取 browser_snapshot');
    if (args.ref && args.selector) throw new Error('ref 与 selector 只能提供一个，以免目标含糊');
  }
  if (tool.name === 'browser_type' && args.ref && args.selector) throw new Error('ref 与 selector 只能提供一个，以免目标含糊');
  return args;
}
