// 启动时间线埋点：以本模块首次加载时刻为基准，输出相对秒数，用于定位慢启动瓶颈。
// 用法：在关键节点调用 logger.info(`[timing] +${rel()}s <事件>`)。
export const APP_T0 = Date.now()
export function rel(): string {
  return ((Date.now() - APP_T0) / 1000).toFixed(1)
}
