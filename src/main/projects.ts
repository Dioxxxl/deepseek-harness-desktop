import { loadConfig, updateConfig } from './config.js'

const MAX_RECENT = 12

export function getRecentProjects(): string[] {
  return loadConfig().recentProjects ?? []
}

export function addRecentProject(path: string): string[] {
  const list = getRecentProjects().filter((p) => p !== path)
  list.unshift(path)
  const next = list.slice(0, MAX_RECENT)
  updateConfig({ recentProjects: next })
  return next
}

export function removeRecentProject(path: string): string[] {
  const next = getRecentProjects().filter((p) => p !== path)
  updateConfig({ recentProjects: next })
  return next
}

export function getCurrentCwd(): string {
  return loadConfig().cwd
}
