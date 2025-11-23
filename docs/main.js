let port;
let writer;
let reader; // グローバルで定義

let sensitivity = [200, 200, 200, 200, 200, 200, 200, 200, 200]; // 感度保存用

const BUTTON_CLICK_EVENT = document.getElementById("connection");
const BUTTON_CLICK_EVENT_DISC = document.getElementById("disconnection");
const BUTTON_CLICK_EVENT_send = document.getElementById("sendButton");
const BUTTON_CLICK_EVENT_request = document.getElementById("requestButton");
const BUTTON_CLICK_EVENT_save = document.getElementById("saveButton");
const BUTTON_CLICK_EVENT_reset = document.getElementById("resetButton");

// ドットとテキストを個別に取得
const situationBox = document.getElementById("situationBox");
const situationText = document.getElementById("situationText");
const statusDot = document.getElementById("statusDot");

// --- UI更新用ヘルパー関数 ---
// boxState: 'default' | 'processing' | 'success' | 'error'
// dotState: 'online' | 'offline' | 'error' | null (nullなら変更しない)
function updateUI(message, boxState, dotState = null) {
  // テキスト更新
  situationText.textContent = message;

  // ボックスのクラスリセット & 追加
  situationBox.classList.remove("processing", "success", "error");
  if (boxState !== 'default') {
    situationBox.classList.add(boxState);
  }

  // ドットのクラスリセット & 追加 (指定がある場合のみ)
  if (dotState) {
    statusDot.classList.remove("online", "offline", "error");
    statusDot.classList.add(dotState);
  }
}

// 初期化
updateUI("接続してください", "default", "offline");

// --- シリアルポート接続処理 ---
BUTTON_CLICK_EVENT.addEventListener("click", async () => {
  try {
    updateUI("接続中...", "processing");

    // ポートがすでに開いている場合、閉じて再接続する
    if (port && port.readable) {
      console.log("Closing existing port...");
      if (writer) writer.releaseLock();
      if (reader) reader.releaseLock();
      await port.close();
    }

    // 新しいポートのリクエスト
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });

    // Linux/Mac対応 - DTR信号を有効化
    await port.setSignals({ dataTerminalReady: true, requestToSend: true });

    // writerとreaderを初期化
    writer = port.writable.getWriter();
    reader = port.readable.getReader();

    console.log("Port connected successfully!");

    // 初期メッセージを送信
    const data = new TextEncoder().encode("Hello, Serial!\n");
    await writer.write(data);
    console.log("Data sent: Hello, Serial!");

    // 成功時: ドットを緑(online)、ボックスを緑(success)
    updateUI("接続完了", "success", "online");

  } catch (error) {
    console.error("Error:", error);
    // 失敗時: ドットを赤(error)、ボックスを黄色(error)
    updateUI("接続エラー", "error", "error");
  }
});

// --- リセット処理 ---
BUTTON_CLICK_EVENT_reset.addEventListener("click", () => {
  // index.htmlの初期値定義に基づくデフォルト値
  const defaultValues = {
    0: 130,
    1: 80,
    2: 130,
    3: 80,
    4: 10,
    5: 30,
    6: 32,
    7: 0,
    8: 1
  };

  try {
    for (let i = 0; i <= 8; i++) {
      const textElement = document.getElementById(`text${i}`);
      const slider = document.getElementById(`volumeSlider${i}`);

      if (slider && textElement) {
        const defVal = defaultValues[i];

        // 値を更新
        slider.value = defVal;
        textElement.textContent = defVal;
        sensitivity[i] = defVal;
      }
    }
    updateUI("感度をリセットしました", "success");
  } catch (error) {
    console.error("Reset error:", error);
    updateUI("リセットエラー", "error");
  }
});

// ウィンドウを閉じる前にポートを閉じる
window.addEventListener("beforeunload", async () => {
  if (writer) writer.releaseLock();
  if (reader) reader.releaseLock();
  if (port) await port.close();
});

// 切断処理
BUTTON_CLICK_EVENT_DISC.addEventListener("click", async () => {
  try {
    if (writer) writer.releaseLock();
    if (reader) reader.releaseLock();
    if (port) await port.close();

    // 切断時: ドットをグレー(offline)、ボックスはデフォルト
    updateUI("切断しました", "default", "offline");
  } catch (e) {
    console.error(e);
  }
});

// --- データ送信処理 ---
BUTTON_CLICK_EVENT_send.addEventListener("click", async () => {
  if (!writer) return;
  try {
    updateUI("感度送信中...", "processing");

    // "1002"の送信
    await writer.write(new TextEncoder().encode("1002\n"));

    for (let i = 0; i < 9; i++) {
      await new Promise(resolve => setTimeout(resolve, 50)); // 少し待機
      const data = `${i}:${sensitivity[i]}`;
      const encodedData = new TextEncoder().encode(data);
      await writer.write(encodedData);
    }

    updateUI("感度を送信しました", "success");
  } catch (error) {
    console.error("Error in send:", error);
    updateUI("送信エラー", "error");
  }
});

// --- データ要求処理 (Linux対応: バッファリング実装) ---
BUTTON_CLICK_EVENT_request.addEventListener("click", async () => {
  if (!writer || !reader) return;
  try {
    updateUI("受信待機中...", "processing");

    // "1000"を送信して感度データを要求
    await writer.write(new TextEncoder().encode("1000\n"));

    // データ受信用のバッファとデコーダー
    let buffer = "";
    const textDecoder = new TextDecoder();

    let receivedCounts = 0;
    const targetCounts = 9; // 0~8の9個

    // 読み取りループ
    while (port.readable && receivedCounts < targetCounts) {
      const { value, done } = await reader.read();
      if (done) break;

      // 受信データをデコードしてバッファに追加
      if (value) {
        buffer += textDecoder.decode(value, { stream: true });
      }

      // 改行コードで分割
      let lines = buffer.split("\n");

      // 最後の要素は不完全な可能性があるのでバッファに戻す
      buffer = lines.pop() || ""; 

      for (const line of lines) {
        const cleanLine = line.trim();
        if (!cleanLine) continue;

        const parts = cleanLine.split(":");
        if (parts.length === 2) {
          const index = parseInt(parts[0]);
          const val = parseInt(parts[1]);

          // バリデーション
          if (!isNaN(index) && index >= 0 && index <= 8 && !isNaN(val)) {
            const textElement = document.getElementById(`text${index}`);
            const slider = document.getElementById(`volumeSlider${index}`);

            if (textElement && slider) {
              sensitivity[index] = val; // 配列更新
              slider.value = val; // スライダー更新
              textElement.textContent = val; // 表示更新

              receivedCounts++;
            }
          }
        }
      }
    }

    updateUI("感度を受け取りました", "success");
  } catch (error) {
    console.error("Error in request:", error);
    updateUI("受信エラー", "error");
  }
});

// 保存処理
BUTTON_CLICK_EVENT_save.addEventListener("click", async () => {
    if(!writer) return;
    try {
      updateUI("保存中...", "processing");
      await writer.write(new TextEncoder().encode("1001\n"));
      console.log("1001_saved");
      updateUI("感度を保存しました", "success");
    } catch (e) {
      console.error(e);
      updateUI("保存エラー", "error");
    }
});


// --- スライダー制御 ---
for (let i = 0; i <= 8; i++) {
  const textElement = document.getElementById(`text${i}`);
  const slider = document.getElementById(`volumeSlider${i}`);

  if (slider && textElement) {
    // 初期表示設定
    textElement.textContent = slider.value;
    sensitivity[i] = parseInt(slider.value);

    // 操作時イベント
    slider.addEventListener("input", () => {
      const volume = slider.value;
      textElement.textContent = volume;
      sensitivity[i] = parseInt(volume);
    });
  }
}

const themeSelect = document.getElementById('themeSelect');
const htmlElement = document.documentElement;
const STORAGE_KEY = 'hidtaiko_theme';

// 保存されたテーマがあれば適用、なければSystem
const savedTheme = localStorage.getItem(STORAGE_KEY) || 'system';
applyTheme(savedTheme);
themeSelect.value = savedTheme;

// セレクトボックスの変更イベント
themeSelect.addEventListener('change', (e) => {
  const selectedTheme = e.target.value;
  applyTheme(selectedTheme);
  localStorage.setItem(STORAGE_KEY, selectedTheme);
});

function applyTheme(theme) {
  if (theme === 'system') {
    // 属性を削除すると CSSの @media (prefers-color-scheme) が有効になる
    htmlElement.removeAttribute('data-theme');
  } else {
    // light または dark を強制適用
    htmlElement.setAttribute('data-theme', theme);
  }
}
