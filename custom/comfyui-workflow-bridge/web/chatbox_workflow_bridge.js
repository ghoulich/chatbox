import { app } from '../../scripts/app.js'

const BRIDGE_PATH = '/chatbox-bridge/v1/workflows'

async function syncActiveWorkflow() {
  const built = await app.graphToPrompt()
  const graph = app.graph
  graph.extra ??= {}
  const bridgeState = graph.extra.chatboxBridge ?? {}
  const defaultName = bridgeState.name || 'ComfyUI Workflow'
  const name = window.prompt('Workflow name for ChatBox synchronization', defaultName)?.trim()
  if (!name) return

  const body = {
    id: bridgeState.id,
    expectedRevision: bridgeState.revision,
    name,
    uiWorkflow: built.workflow,
    apiWorkflow: built.output,
    mapping: bridgeState.mapping ?? {},
    capabilities: bridgeState.capabilities ?? {},
  }
  const response = await fetch(BRIDGE_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (response.status === 409) {
    window.alert('The remote workflow changed. Refresh it in ChatBox or reopen the ComfyUI copy before saving.')
    return
  }
  if (!response.ok) {
    throw new Error(result.message || result.error || `Bridge returned HTTP ${response.status}`)
  }
  graph.extra.chatboxBridge = {
    id: result.id,
    revision: result.revision,
    name: result.name,
    mapping: result.mapping ?? {},
    capabilities: result.capabilities ?? {},
  }
  app.graph.setDirtyCanvas?.(true, true)
  window.alert(`Workflow “${result.name}” synchronized to ChatBox.`)
}

app.registerExtension({
  name: 'Chatbox.WorkflowBridge',
  commands: [
    {
      id: 'Chatbox.WorkflowBridge.SyncActive',
      label: 'Sync current workflow to ChatBox',
      function: async () => {
        try {
          await syncActiveWorkflow()
        } catch (error) {
          window.alert(`Unable to synchronize workflow: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    },
  ],
  menuCommands: [
    {
      path: ['Chatbox Bridge'],
      commands: ['Chatbox.WorkflowBridge.SyncActive'],
    },
  ],
})
