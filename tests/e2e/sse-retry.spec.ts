import { test, expect } from '@playwright/test';

const INPUT = 'textarea[placeholder="请输入需要检测的中文文本..."]';
const START_BTN_NAME = '开始检测';
const CANCEL_BTN_NAME = '取消';

/**
 * 生成唯一的测试ID
 * @param prefix 前缀标识符
 * @returns 唯一ID字符串
 */
function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

/**
 * 使用URL方式设置场景cookies
 * @param page Playwright页面对象
 * @param scenario 测试场景名称
 * @param id 唯一测试ID
 */
async function setScenarioCookies(page, scenario: string, id: string): Promise<void> {
  const url = 'http://localhost:3000';
  await page.context().addCookies([
    { name: 'e2e_scenario', value: scenario, url },
    { name: 'e2e_id', value: id, url },
  ]);
}

/**
 * 执行一次完整的检测流程
 * @param page Playwright页面对象
 */
async function runOnce(page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(INPUT);
  await page.fill(INPUT, '这是一段用于自动化测试的中文文本。');
  await page.getByRole('button', { name: START_BTN_NAME }).click();
  // 进入运行态可能非常短（如快速完成的场景），此处不强制等待"取消"按钮出现
}

/**
 * 等待检测完成且无错误
 * @param page Playwright页面对象
 */
async function waitFinishWithoutError(page): Promise<void> {
  // 等待按钮回到"开始检测"，表示流程结束
  await expect(page.getByRole('button', { name: START_BTN_NAME })).toBeVisible({ timeout: 20000 });
  // 不应出现错误提示条，限定在main区域内以避免Next Dev Overlay干扰
  const alert = page.locator('main [role="alert"]');
  await expect(alert).toHaveCount(0);
}

test.describe('SSE 重试与解析健壮性', () => {
  // 为每个测试用例存储唯一ID
  let testId: string;
  
  test.beforeEach(async ({ page }) => {
    // 为每个测试生成唯一ID
    testId = makeId('test');
    

  });
  
  test.afterEach(async ({ context }) => {
    // 每个测试后清理cookies
    await context.clearCookies();
  });

  test('SSE 垃圾行忽略 -> 最终成功', async ({ page }) => {
    const caseId = makeId('case-garbage');
    await setScenarioCookies(page, 'sse-garbage-then-final', caseId);
    await runOnce(page);
    // 不应因为垃圾行报"响应格式不正确"或"未知错误"
    await expect(page.locator('main [role="alert"]:has-text("响应格式不正确")')).toHaveCount(0);
    await expect(page.locator('main [role="alert"]:has-text("检查时发生未知错误")')).toHaveCount(0);
    await waitFinishWithoutError(page);
  });

  test('用户取消 long-stream', async ({ page }) => {
    const caseId = makeId('case-cancel');
    await setScenarioCookies(page, 'long-stream', caseId);
    await runOnce(page);
    // 稍等片刻，确认进入流模式
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: CANCEL_BTN_NAME }).click();
    // 取消后应显示取消提示并回到开始按钮
    await expect(page.locator('main [role="alert"]:has-text("请求已取消")')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: START_BTN_NAME })).toBeVisible();
  });

  test('总时长上限 idle-no-final -> 超时提示', async ({ page }) => {
    const caseId = makeId('case-timeout');
    await setScenarioCookies(page, 'idle-no-final', caseId);
    await runOnce(page);
    // 等待最终的超时错误提示（前端总时长 5s）
    await expect(page.locator('main [role="alert"]:has-text("超时")')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: START_BTN_NAME })).toBeVisible();
  });
});
