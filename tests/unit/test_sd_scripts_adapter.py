import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


ADAPTER_PATH = Path(__file__).resolve().parents[2] / "external" / "training" / "sd_scripts_adapter.py"
SPEC = importlib.util.spec_from_file_location("sd_scripts_adapter", ADAPTER_PATH)
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)


class SdScriptsAdapterTests(unittest.TestCase):
    def parse_args(self, *extra):
        argv = [
            "sd_scripts_adapter.py",
            "--dataset_dir", "/dataset",
            "--output_dir", "/models/loras",
            "--output_name", "aria_lora",
            "--base_model_path", "/models/base.safetensors",
            "--trigger_token", "kirea_aria",
            *extra,
        ]
        with patch.object(sys, "argv", argv):
            return adapter.parse_args()

    def test_forwards_accumulation_checkpointing_cadence_and_precision(self):
        args = self.parse_args(
            "--gradient_accumulation_steps", "4",
            "--gradient_checkpointing", "false",
            "--save_every_n_epochs", "3",
            "--precision", "bf16",
        )
        command = adapter.build_command(args, "/sd-scripts/sdxl_train_network.py", "/dataset.toml")

        self.assertIn("--gradient_accumulation_steps=4", command)
        self.assertNotIn("--gradient_checkpointing", command)
        self.assertIn("--save_every_n_epochs=3", command)
        self.assertIn("--mixed_precision=bf16", command)
        self.assertIn("--save_precision=bf16", command)
        self.assertIn("--output_dir=/models/loras", command)
        self.assertIn("--output_name=aria_lora", command)

    def test_enables_gradient_checkpointing_only_when_requested(self):
        args = self.parse_args("--gradient_checkpointing", "true")
        command = adapter.build_command(args, "/sd-scripts/sdxl_train_network.py", "/dataset.toml")

        self.assertIn("--gradient_checkpointing", command)

    def test_rejects_output_name_traversal(self):
        args = self.parse_args()
        args.output_name = "../../escape"

        with self.assertRaises(ValueError):
            adapter.validate_output_paths(args)

    def test_accepts_a_contained_output_path(self):
        args = self.parse_args()
        output_dir, output_path = adapter.validate_output_paths(args)

        self.assertEqual(output_dir, os.path.abspath("/models/loras"))
        self.assertEqual(
            output_path,
            os.path.join(output_dir, "aria_lora.safetensors"),
        )


if __name__ == "__main__":
    unittest.main()
