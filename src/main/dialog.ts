import { dialog } from 'electron'

/** 原生「选择项目目录」对话框；返回选中路径或 null。 */
export async function selectProjectDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '选择 Harness 工作目录（Agent 将在此读写文件）',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}
