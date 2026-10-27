#!/usr/bin/env python3
"""
Воркер дообучения Unsloth (SFT / GRPO) для платформы WORK.
Оптимизирован под машины с большой единой памятью (AMD Ryzen AI Max+ PRO / 495 PRO 192 GB Unified RAM, ROCm / CUDA).
Принимает JSON-конфигурацию через аргумент `--config <path>` и выводит телеметрию каждого шага в stdout в формате JSONL.
"""
import argparse
import json
import os
import sys
import time


def emit(event_type, **payload):
    msg = {"event": event_type, "time": time.time(), **payload}
    print(json.dumps(msg, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description="WORK Unsloth Trainer Worker")
    parser.add_argument("--config", required=True, help="Path to training job config JSON")
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    base_model = cfg.get("baseModel", "unsloth/Qwen3-32B-bnb-4bit")
    dataset_file = cfg.get("datasetFile", "")
    output_dir = cfg.get("outputDir", "./lora_adapter")
    mode = cfg.get("mode", "sft")  # 'sft' | 'grpo'
    max_seq_length = int(cfg.get("maxSeqLength", 8192))
    lora_r = int(cfg.get("loraR", 16))
    lora_alpha = int(cfg.get("loraAlpha", 32))
    epochs = int(cfg.get("epochs", 2))
    learning_rate = float(cfg.get("learningRate", 2e-4))
    export_gguf = bool(cfg.get("exportGguf", False))
    gguf_quant = cfg.get("ggufQuant", "q8_0")

    os.makedirs(output_dir, exist_ok=True)
    emit("init", baseModel=base_model, mode=mode, maxSeqLength=max_seq_length, loraR=lora_r)

    from unsloth import FastLanguageModel
    from datasets import load_dataset
    from transformers import TrainingArguments, TrainerCallback
    from trl import SFTTrainer

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base_model,
        max_seq_length=max_seq_length,
        dtype=None,
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=lora_r,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=lora_alpha,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=3407,
    )

    dataset = load_dataset("json", data_files=dataset_file, split="train")

    def format_prompts(examples):
        texts = []
        for msgs in examples["messages"]:
            text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
            texts.append(text)
        return {"text": texts}

    dataset = dataset.map(format_prompts, batched=True)

    class TelemetryCallback(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            if logs:
                emit(
                    "step",
                    step=state.global_step,
                    totalSteps=state.max_steps,
                    epoch=round(state.epoch or 0, 2),
                    loss=round(float(logs.get("loss", 0.0)), 4) if "loss" in logs else None,
                    lr=logs.get("learning_rate"),
                )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=max_seq_length,
        dataset_num_proc=2,
        packing=False,
        callbacks=[TelemetryCallback()],
        args=TrainingArguments(
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            warmup_steps=5,
            num_train_epochs=epochs,
            learning_rate=learning_rate,
            logging_steps=1,
            optim="adamw_8bit",
            weight_decay=0.01,
            lr_scheduler_type="linear",
            seed=3407,
            output_dir=output_dir,
            report_to="none",
        ),
    )

    trainer.train()
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    if export_gguf:
        gguf_dir = os.path.join(output_dir, "gguf")
        model.save_pretrained_gguf(gguf_dir, tokenizer, quantization_method=gguf_quant)

    emit("completed", outputDir=output_dir)


if __name__ == "__main__":
    main()
