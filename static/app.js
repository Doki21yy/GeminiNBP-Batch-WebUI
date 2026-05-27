const keyStatus = document.querySelector("#keyStatus");
const setKeyBtn = document.querySelector("#setKeyBtn");
const keyDialog = document.querySelector("#keyDialog");
const apiKeyInput = document.querySelector("#apiKeyInput");
const saveKeyBtn = document.querySelector("#saveKeyBtn");
const cancelKeyBtn = document.querySelector("#cancelKeyBtn");
const form = document.querySelector("#generateForm");
const generateBtn = document.querySelector("#generateBtn");
const clearBtn = document.querySelector("#clearBtn");
const downloadAllBtn = document.querySelector("#downloadAllBtn");
const resultGrid = document.querySelector("#resultGrid");
const summary = document.querySelector("#summary");
const promptInput = document.querySelector("#promptInput");
const batchCountInput = document.querySelector("#batchCount");
const referenceImagesInput = document.querySelector("#referenceImages");
const referenceModeInput = document.querySelector("#referenceMode");
const taskPreview = document.querySelector("#taskPreview");
let currentImageUrls = [];
let currentDownloadFiles = [];
let currentResults = [];
let currentTaskPayloads = [];
let lastSettings = null;
const LOCAL_KEY_STORAGE = "gemini_nbp_api_key";
let isVercelMode = false;

async function refreshKeyStatus() {
  const response = await fetch("/api/key");
  const data = await response.json();
  isVercelMode = Boolean(data.vercel);
  if (isVercelMode) {
    const browserKey = localStorage.getItem(LOCAL_KEY_STORAGE)?.trim();
    const hasBrowserKey = Boolean(browserKey);
    if (hasBrowserKey) {
      keyStatus.textContent = "API Key 已设置（当前浏览器）";
    } else if (data.configured) {
      keyStatus.textContent = "API Key 已设置（Vercel 环境变量）";
    } else {
      keyStatus.textContent = "API Key 未设置（请点击右上角按钮设置）";
    }
    setKeyBtn.disabled = false;
    setKeyBtn.title = "为当前浏览器设置独立 API Key";
    if (!taskPreview.textContent.includes("Vercel")) {
      taskPreview.textContent = `${estimateTaskCount()}（Vercel 模式按任务分批请求）`;
    }
  } else {
    keyStatus.textContent = data.configured ? "API Key 已设置" : "API Key 未设置";
    setKeyBtn.disabled = false;
    setKeyBtn.title = "";
  }
}

function splitPrompts(text, batchCount) {
  const prompts = text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  if (prompts.length === 1 && batchCount > 1) {
    return Array.from({ length: batchCount }, () => prompts[0]);
  }
  return prompts;
}

function buildTasks(prompts, referenceImages, referenceMode) {
  if (referenceMode === "split" && referenceImages.length) {
    if (prompts.length === referenceImages.length) {
      return prompts.map((prompt, index) => ({
        prompt,
        referenceImages: [referenceImages[index].dataUrl],
        referenceNames: [referenceImages[index].name],
        referenceLabel: `参考图 ${index + 1}`,
      }));
    }

    if (prompts.length === 1) {
      return referenceImages.map((image, index) => ({
        prompt: prompts[0],
        referenceImages: [image.dataUrl],
        referenceNames: [image.name],
        referenceLabel: `参考图 ${index + 1}`,
      }));
    }

    throw new Error(`参考图拆分模式下，prompt 数量需要是 1 个或等于图片数量。当前 prompt ${prompts.length} 个，图片 ${referenceImages.length} 张。`);
  }

  return prompts.map((prompt) => ({
    prompt,
    referenceImages: referenceImages.map((image) => image.dataUrl),
    referenceNames: referenceImages.map((image) => image.name),
    referenceLabel: referenceImages.length ? `${referenceImages.length} 张参考图` : "无参考图",
  }));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl, mimeType = "image/jpeg", quality = 0.82, maxSide = 1280) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
      resolve(canvas.toDataURL(mimeType, quality));
    };
    image.onerror = () => reject(new Error("图片压缩失败"));
    image.src = dataUrl;
  });
}

async function readReferenceImages() {
  const files = Array.from(referenceImagesInput.files);
  const dataUrls = await Promise.all(files.map(fileToDataUrl));
  const compressed = await Promise.all(dataUrls.map((dataUrl) => compressImageDataUrl(dataUrl)));
  return files.map((file, index) => ({
    name: file.name,
    dataUrl: compressed[index],
  }));
}

function downloadNameForResult(result, imageIndex = 0) {
  const referenceName = result.taskPayload?.referenceNames?.[0];
  if (!referenceName) {
    return undefined;
  }
  if ((result.image_urls?.length || 0) <= 1) {
    return referenceName;
  }
  const path = referenceName.split(".");
  const ext = path.length > 1 ? path.pop() : "png";
  const stem = path.join(".") || referenceName;
  return `${stem}_${imageIndex + 1}.${ext}`;
}

function estimateTaskCount() {
  const prompts = splitPrompts(promptInput.value, Number(batchCountInput.value || 1));
  const imageCount = referenceImagesInput.files.length;
  const mode = referenceModeInput.value;

  if (mode === "split" && imageCount) {
    if (prompts.length === 1) {
      return `当前会创建 ${imageCount} 个任务：同一个 prompt + 每张参考图各跑一次`;
    }
    if (prompts.length === imageCount) {
      return `当前会创建 ${imageCount} 个任务：每行 prompt 对应同序号参考图`;
    }
    return `数量不匹配：${prompts.length} 个 prompt，${imageCount} 张参考图`;
  }

  return `当前会创建 ${prompts.length} 个任务：每个任务都带 ${imageCount} 张参考图`;
}

function makeCard(result) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.resultIndex = String(result.index ?? "");

  const imageWrap = document.createElement("div");
  imageWrap.className = "cardImage";
  if (result.image_urls?.length) {
    const image = document.createElement("img");
    image.src = result.image_urls[0];
    image.alt = result.prompt;
    imageWrap.append(image);
  } else {
    imageWrap.textContent = result.status === "error" ? "生成失败" : "无图片返回";
  }

  const body = document.createElement("div");
  body.className = "cardBody";

  const status = document.createElement("span");
  status.className = `status ${result.status}`;
  status.textContent = result.status === "success" ? "成功" : "失败";

  const prompt = document.createElement("div");
  prompt.className = "prompt";
  prompt.textContent = result.referenceLabel ? `${result.prompt} · ${result.referenceLabel}` : result.prompt;

  body.append(status, prompt);

  if (result.error) {
    const error = document.createElement("div");
    error.className = "errorText";
    error.textContent = result.error;
    body.append(error);
  }

  if (result.request_debug) {
    const debug = document.createElement("div");
    debug.className = "meta";
    debug.textContent = `请求：${result.request_debug.reference_images ?? 0} 张参考图，${JSON.stringify(result.request_debug.generation_config || {})}`;
    body.append(debug);
  }

  if (result.image_urls?.length > 1) {
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `返回 ${result.image_urls.length} 张图`;
    body.append(meta);
  }

  if (result.text) {
    const text = document.createElement("div");
    text.className = "meta";
    text.textContent = result.text;
    body.append(text);
  }

  if (result.taskPayload) {
    const actions = document.createElement("div");
    actions.className = "cardActions";
    const rerunButton = document.createElement("button");
    rerunButton.className = "secondary";
    rerunButton.type = "button";
    rerunButton.textContent = "再试一次";
    rerunButton.addEventListener("click", () => rerunTask(result.index));
    actions.append(rerunButton);
    body.append(actions);
  }

  card.append(imageWrap, body);
  return card;
}

function renderLoadingCards(tasks) {
  currentImageUrls = [];
  currentDownloadFiles = [];
  currentResults = [];
  currentTaskPayloads = [];
  downloadAllBtn.disabled = true;
  resultGrid.replaceChildren();
  tasks.forEach((task, index) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="cardImage">任务 ${index + 1} 等待返回</div>
      <div class="cardBody">
        <span class="status">生成中</span>
        <div class="prompt"></div>
      </div>
    `;
    card.querySelector(".prompt").textContent = `${task.prompt} · ${task.referenceLabel}`;
    resultGrid.append(card);
  });
}

setKeyBtn.addEventListener("click", () => {
  apiKeyInput.value = "";
  keyDialog.showModal();
  apiKeyInput.focus();
});

cancelKeyBtn.addEventListener("click", () => keyDialog.close());

saveKeyBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    apiKeyInput.focus();
    return;
  }

  saveKeyBtn.disabled = true;
  try {
    if (isVercelMode) {
      localStorage.setItem(LOCAL_KEY_STORAGE, apiKey);
    } else {
      const response = await fetch("/api/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
    }
    keyDialog.close();
    await refreshKeyStatus();
  } finally {
    saveKeyBtn.disabled = false;
  }
});

clearBtn.addEventListener("click", () => {
  currentImageUrls = [];
  currentDownloadFiles = [];
  currentResults = [];
  currentTaskPayloads = [];
  downloadAllBtn.disabled = true;
  resultGrid.replaceChildren();
  summary.textContent = "等待任务";
});

async function generateTask(taskPayload, settings) {
  const browserApiKey = localStorage.getItem(LOCAL_KEY_STORAGE)?.trim();
  const payload = {
    prompts: [taskPayload.prompt],
    model_name: settings.modelName,
    max_tokens: settings.maxTokens,
    image_size: settings.imageSize,
    aspect_ratio: settings.aspectRatio,
    api_key: browserApiKey || undefined,
    concurrency: 1,
    reference_image_groups: [taskPayload.referenceImages],
  };

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();
  return data.results[0];
}

async function runTasksWithConcurrency(tasks, concurrency, runTask) {
  const results = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) {
        return;
      }
      try {
        const result = await runTask(tasks[index], index);
        results[index] = result;
      } catch (error) {
        results[index] = {
          status: "error",
          prompt: tasks[index].prompt,
          error: error.message,
        };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency || 1, tasks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function refreshDownloadState() {
  currentImageUrls = currentResults.flatMap((result) => result?.image_urls || []);
  currentDownloadFiles = currentResults.flatMap((result) =>
    (result?.image_urls || []).map((imageUrl, imageIndex) => ({
      image_url: imageUrl,
      filename: downloadNameForResult(result, imageIndex),
    })),
  );
  downloadAllBtn.disabled = currentImageUrls.length === 0;
}

async function rerunTask(index) {
  const taskPayload = currentTaskPayloads[index];
  if (!taskPayload || !lastSettings) {
    summary.textContent = "找不到原任务参数";
    return;
  }

  const oldCard = resultGrid.querySelector(`[data-result-index="${index}"]`);
  if (oldCard) {
    oldCard.querySelector(".cardImage").textContent = "重新生成中";
  }
  summary.textContent = `重新提交任务 ${index + 1}`;

  try {
    const result = await generateTask(taskPayload, lastSettings);
    const merged = {
      ...result,
      index,
      referenceLabel: taskPayload.referenceLabel,
      taskPayload,
    };
    currentResults[index] = merged;
    refreshDownloadState();
    if (oldCard) {
      oldCard.replaceWith(makeCard(merged));
    }
    summary.textContent = `任务 ${index + 1} 已重新生成`;
  } catch (error) {
    summary.textContent = error.message;
  }
}

downloadAllBtn.addEventListener("click", async () => {
  if (!currentImageUrls.length) {
    summary.textContent = "当前没有可下载图片";
    return;
  }

  downloadAllBtn.disabled = true;
  try {
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: currentDownloadFiles }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    link.href = url;
    link.download = `gemini_nbp_results_${stamp}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    summary.textContent = `已打包 ${currentImageUrls.length} 张图片`;
  } catch (error) {
    summary.textContent = error.message;
  } finally {
    downloadAllBtn.disabled = currentImageUrls.length === 0;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const prompts = splitPrompts(
    document.querySelector("#promptInput").value,
    Number(document.querySelector("#batchCount").value || 1),
  );

  generateBtn.disabled = true;

  try {
    const referenceImages = await readReferenceImages();
    const tasks = buildTasks(prompts, referenceImages, referenceModeInput.value);
    if (!tasks.length) {
      summary.textContent = "请先输入 prompt";
      return;
    }

    renderLoadingCards(tasks);
    summary.textContent = `提交 ${tasks.length} 个任务`;
    lastSettings = {
      modelName: document.querySelector("#modelName").value.trim() || "gemini_nbp",
      maxTokens: Number(document.querySelector("#maxTokens").value),
      imageSize: document.querySelector("#imageSize").value,
      aspectRatio: document.querySelector("#aspectRatio").value,
    };
    currentTaskPayloads = tasks;

    const concurrency = Number(document.querySelector("#concurrency").value);
    let mergedResults = [];

    if (isVercelMode) {
      // Avoid FUNCTION_PAYLOAD_TOO_LARGE: send one task per request in Vercel mode.
      const singleResults = await runTasksWithConcurrency(tasks, concurrency, async (task, index) => {
        const result = await generateTask(task, lastSettings);
        return { ...result, index };
      });
      mergedResults = tasks.map((task, index) => ({
        ...singleResults[index],
        index,
        referenceLabel: task.referenceLabel,
        taskPayload: task,
      }));
    } else {
      const payload = {
        prompts: tasks.map((task) => task.prompt),
        model_name: lastSettings.modelName,
        max_tokens: lastSettings.maxTokens,
        image_size: lastSettings.imageSize,
        aspect_ratio: lastSettings.aspectRatio,
        api_key: localStorage.getItem(LOCAL_KEY_STORAGE)?.trim() || undefined,
        concurrency,
        reference_image_groups: tasks.map((task) => task.referenceImages),
      };

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text);
      }

      const data = await response.json();
      const resultByIndex = new Map(data.results.map((result) => [result.index, result]));
      mergedResults = tasks.map((task, index) => ({
        ...resultByIndex.get(index),
        index,
        referenceLabel: task.referenceLabel,
        taskPayload: task,
      }));
    }

    currentResults = mergedResults;
    refreshDownloadState();
    resultGrid.replaceChildren(...mergedResults.map(makeCard));
    const successCount = mergedResults.filter((item) => item?.status === "success").length;
    summary.textContent = `完成 ${successCount}/${mergedResults.length}，失败 ${mergedResults.length - successCount}`;
  } catch (error) {
    summary.textContent = error.message;
  } finally {
    generateBtn.disabled = false;
  }
});

promptInput.addEventListener("input", () => {
  taskPreview.textContent = estimateTaskCount();
});
batchCountInput.addEventListener("input", () => {
  taskPreview.textContent = estimateTaskCount();
});
referenceImagesInput.addEventListener("change", () => {
  taskPreview.textContent = estimateTaskCount();
});
referenceModeInput.addEventListener("change", () => {
  taskPreview.textContent = estimateTaskCount();
});

taskPreview.textContent = estimateTaskCount();

refreshKeyStatus().catch(() => {
  keyStatus.textContent = "无法读取 API Key 状态";
});
