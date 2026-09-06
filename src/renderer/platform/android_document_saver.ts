import { registerPlugin } from '@capacitor/core'

export interface SaveFileOptions {
  sourceUri: string
  suggestedName: string
  mimeType?: string
}

export interface SaveFileResult {
  uri: string
}

export interface SkillDirectoryResult {
  uri: string
  name?: string
}

export interface ScannedSkillFile {
  path: string
  content: string
}

export interface ScanSkillDirectoryResult {
  files: ScannedSkillFile[]
  truncated?: boolean
}

export interface AndroidDocumentSaverPlugin {
  saveFile(options: SaveFileOptions): Promise<SaveFileResult>
  selectSkillDirectory(): Promise<SkillDirectoryResult>
  scanSkillDirectory(options: { uri: string }): Promise<ScanSkillDirectoryResult>
}

export const AndroidDocumentSaver = registerPlugin<AndroidDocumentSaverPlugin>('DocumentSaver')
