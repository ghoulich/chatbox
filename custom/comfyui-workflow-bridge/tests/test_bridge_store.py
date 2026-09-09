import json
import tempfile
import unittest
from pathlib import Path

from bridge_store import BridgeConflictError, BridgeValidationError, WorkflowBridgeStore


def payload(name="Example"):
    return {
        "name": name,
        "uiWorkflow": {"last_node_id": 1, "nodes": [], "links": [], "version": 0.4},
        "apiWorkflow": {"1": {"inputs": {"text": "hello"}, "class_type": "CLIPTextEncode"}},
        "mapping": {"positivePrompt": "1.text"},
        "capabilities": {"textToImage": True},
    }


class WorkflowBridgeStoreTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.store = WorkflowBridgeStore(self.root)

    def tearDown(self):
        self.temporary.cleanup()

    def test_create_writes_pair_and_lists_metadata(self):
        saved = self.store.save(payload())
        self.assertEqual(saved["revision"], 1)
        self.assertEqual(len(saved["contentHash"]), 64)
        self.assertTrue((self.root / saved["uiPath"]).is_file())
        self.assertEqual(self.store.list()[0]["id"], saved["id"])
        stored_ui = json.loads((self.root / saved["uiPath"]).read_text(encoding="utf-8"))
        self.assertEqual(stored_ui["extra"]["chatboxBridge"]["id"], saved["id"])

    def test_update_requires_matching_revision_and_removes_old_ui_name(self):
        saved = self.store.save(payload("First"))
        update = payload("Second")
        update.update({"id": saved["id"], "expectedRevision": saved["revision"]})
        updated = self.store.save(update)
        self.assertEqual(updated["revision"], 2)
        self.assertFalse((self.root / saved["uiPath"]).exists())
        self.assertTrue((self.root / updated["uiPath"]).exists())

        update["expectedRevision"] = 1
        with self.assertRaises(BridgeConflictError):
            self.store.save(update)

    def test_delete_requires_revision_and_removes_both_files(self):
        saved = self.store.save(payload())
        with self.assertRaises(BridgeConflictError):
            self.store.delete(saved["id"], 0)
        self.store.delete(saved["id"], 1)
        self.assertEqual(self.store.list(), [])
        self.assertFalse((self.root / saved["uiPath"]).exists())

    def test_unmanaged_native_workflow_is_reported(self):
        native = self.root / "workflows" / "Manual.json"
        native.parent.mkdir(parents=True)
        native.write_text("{}", encoding="utf-8")
        result = self.store.list_unmanaged()
        self.assertEqual(result[0]["path"], "workflows/Manual.json")

    def test_rejects_non_api_workflow(self):
        invalid = payload()
        invalid["apiWorkflow"] = {"nodes": []}
        with self.assertRaises(BridgeValidationError):
            self.store.save(invalid)

    def test_rejects_invalid_ui_extra(self):
        invalid = payload()
        invalid["uiWorkflow"]["extra"] = []
        with self.assertRaises(BridgeValidationError):
            self.store.save(invalid)

    def test_tampered_ui_path_cannot_escape_user_root(self):
        saved = self.store.save(payload())
        bundle_path = self.root / "chatbox-bridge" / "workflows" / f"{saved['id']}.json"
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        bundle["uiPath"] = "../../outside.json"
        bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
        with self.assertRaises(BridgeValidationError):
            self.store.delete(saved["id"], saved["revision"])


if __name__ == "__main__":
    unittest.main()
