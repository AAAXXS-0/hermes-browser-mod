import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { callService, VERSION } from './paths.mjs';
import { ensureRunning } from './launcher.mjs';
import { validateToolArguments } from './tool-validation.mjs';
import { formatMcpResult } from './mcp-results.mjs';

const fields = {
  url: { type: 'string', description: 'HTTP/HTTPS URL' },
  ref: { type: 'string', description: '最新 browser_snapshot 中明确标注的元素引用，如 e3。不得按 tree 顺序猜编号；旧快照引用不可复用。' },
  selector: { type: 'string', description: '可选 Playwright CSS/role 选择器，优先使用 ref' },
  text: { type: 'string' }, key: { type: 'string', description: 'Playwright 按键，例如 Enter、Control+A' },
  tabId: { type: 'string' },
  screenshotId: { type: 'string', description: '最近一次 browser_screenshot 返回的截图编号。页面操作、滚动或切换后需重新截图。' },
  x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 },
  coordinateSpace: { type: 'string', enum: ['image', 'viewport', 'normalized'], description: '默认 image：截图实际像素。viewport：CSS 视口像素。normalized：0–1 比例（不含 1）。' },
};
const tool = (name, description, properties = {}, required = []) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
const tools = [
  tool('browser_state', '查看侧栏当前显示的浏览器标签页及控制权状态。'),
  tool('browser_snapshot', '读取主页面及跨域/嵌套 iframe 内的按钮和编辑器，ref 可直接点击或填写。优先 ref，避免反复用视觉估坐标。每次调用使旧 ref 失效。默认精简 tree，可设 includeTree=true 获取有上限的完整树；tree 顺序不是 ref 编号。', { includeTree: { type: 'boolean' } }),
  tool('browser_navigate', '在侧栏当前标签页打开 URL。用户手动接管时不可操作。', { url: fields.url }, ['url']),
  tool('browser_click', '点击最新 snapshot 中明确对应目标的元素。ref 与 selector 提供一个。返回实际点击目标；点击成功不代表页面已进入，请用新快照核对。此工具不支持 hover 或 action 参数；无变化时不要重复猜测点击。', { ref: fields.ref, selector: fields.selector }),
  tool('browser_fill', '替换输入框或富文本编辑器内容，支持 iframe ref。ref 与 selector 提供一个。若网站要求逐字事件，改用 browser_type。', { ref: fields.ref, selector: fields.selector, text: fields.text }, ['text']),
  tool('browser_type', '逐字符输入中文/英文，不用剪贴板。支持 iframe 富文本编辑器；可提供 ref/selector 自动聚焦，或先点击编辑器后省略目标。追加内容，不自动清空；换行发送 Enter。每次最多 500 字符，长文分段并核对。失败会报告已发送字符数，不要盲目重试。', { ref: fields.ref, selector: fields.selector, text: { type: 'string', maxLength: 500 }, delayMs: { type: 'integer', minimum: 0, maximum: 50, description: '字符间隔毫秒，默认 5' } }, ['text']),
  tool('browser_press', '向独立浏览器当前焦点按键，iframe 编辑器获得焦点后也适用。不使用操作系统键盘；文本请用 browser_type，替换内容可用 browser_fill。', { key: fields.key }, ['key']),
  tool('browser_scroll', '滚动当前页面。', { x: { type: 'number' }, y: { type: 'number' } }),
  tool('browser_new_tab', '新建标签页并在侧栏显示，可指定 URL。', { url: fields.url }),
  tool('browser_activate_tab', '切换侧栏与 Agent 当前使用的同一标签页。', { tabId: fields.tabId }, ['tabId']),
  tool('browser_close_tab', '关闭指定标签页，至少保留一个。', { tabId: fields.tabId }),
  tool('browser_screenshot', '获取当前视口截图，返回图像、截图编号、实际图像尺寸与页面 CSS 尺寸。DOM 无法定位时根据此图使用 browser_click_at / browser_hover_at。不使用电脑屏幕或侧栏窗口坐标。', { maxWidth: { type: 'integer', minimum: 320, maximum: 1920, description: '可选缩小截图宽度；默认保持 CSS 像素尺寸。坐标以返回的真实 imageWidth/imageHeight 为准。' } }),
  tool('browser_click_at', '按最新截图坐标点击真实网页，支持左/右/中键、单击/双击。用于画布和非标准控件。必须基于截图定位；页面变化时重拍。鼠标事件仅发给独立浏览器，不移动系统鼠标。', { screenshotId: fields.screenshotId, x: fields.x, y: fields.y, coordinateSpace: fields.coordinateSpace, button: { type: 'string', enum: ['left', 'right', 'middle'] }, clickCount: { type: 'integer', enum: [1, 2] } }, ['screenshotId', 'x', 'y']),
  tool('browser_hover_at', '按最新截图坐标悬停，可触发网页的 hover 菜单或提示。悬停后重新截图再点击。只移动独立浏览器的虚拟鼠标。', { screenshotId: fields.screenshotId, x: fields.x, y: fields.y, coordinateSpace: fields.coordinateSpace }, ['screenshotId', 'x', 'y']),
  tool('browser_handle_dialog', '处理网页 alert/confirm/prompt/beforeunload。弹窗会阻塞普通点击和页面操作，此工具可以直接解除等待。beforeunload：accept=false 留在此页，accept=true 离开，可能丢失未保存内容。可指定 tabId；默认处理当前或其他等待中的标签页。', { accept: { type: 'boolean' }, text: fields.text, tabId: fields.tabId }, ['accept']),
  tool('browser_release_control', '交给用户手动操作登录或验证码。只有用户点击交还 Agent 后才能继续操作。'),
];
const actions = { browser_state: 'state', browser_snapshot: 'snapshot', browser_navigate: 'navigate', browser_click: 'click', browser_fill: 'fill', browser_type: 'type', browser_press: 'press', browser_scroll: 'scroll', browser_new_tab: 'new_tab', browser_activate_tab: 'activate_tab', browser_close_tab: 'close_tab', browser_screenshot: 'screenshot', browser_click_at: 'click_at', browser_hover_at: 'hover_at', browser_handle_dialog: 'dialog', browser_release_control: 'control' };

const server = new Server({ name: 'hermes-browser-mod', version: VERSION }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const action = actions[request.params.name];
    if (!action) throw new Error('工具不存在');
    const args = validateToolArguments(tools.find(tool => tool.name === request.params.name), request.params.arguments || {});
    await ensureRunning();
    const result = await callService(action, action === 'control' ? { owner: 'manual' } : args);
    if (action === 'screenshot') {
      const { data, ...metadata } = result;
      return { content: [{ type: 'text', text: JSON.stringify(metadata) }, { type: 'image', data, mimeType: result.mimeType }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(formatMcpResult(result, action, args)) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
await server.connect(new StdioServerTransport());
