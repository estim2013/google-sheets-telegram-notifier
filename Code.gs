const CONFIG_KEYS = {
  telegramToken: 'TELEGRAM_TOKEN',
  sheetId: 'SHEET_ID',
  sheetName: 'SHEET_NAME',
  sheetGid: 'SHEET_GID'
};

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const config = {
    telegramToken: props.getProperty(CONFIG_KEYS.telegramToken),
    sheetId: props.getProperty(CONFIG_KEYS.sheetId),
    sheetName: props.getProperty(CONFIG_KEYS.sheetName),
    sheetGid: props.getProperty(CONFIG_KEYS.sheetGid)
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Missing Script Properties: ${missing.join(', ')}`);
  }

  return config;
}

function sendTelegramMessageToUser(chatId, text) {
  if (!text || String(text).trim() === '') return;

  const { telegramToken } = getConfig();
  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${telegramToken}/sendMessage`,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      }),
      muteHttpExceptions: true
    }
  );

  if (response.getResponseCode() >= 300) {
    console.error(`Telegram API error: ${response.getContentText()}`);
  }
}

function sendTelegramMessage(text) {
  if (!text || String(text).trim() === '') return;

  const props = PropertiesService.getScriptProperties();
  const chatIds = JSON.parse(props.getProperty('CHAT_IDS') || '[]');
  chatIds.forEach(chatId => sendTelegramMessageToUser(chatId, text));
}

function checkNewRows() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const config = getConfig();
    const sheet = SpreadsheetApp.openById(config.sheetId)
      .getSheetByName(config.sheetName);

    if (!sheet) throw new Error(`Sheet not found: ${config.sheetName}`);

    const lastRow = sheet.getLastRow();
    const props = PropertiesService.getScriptProperties();
    const stateKey = `LAST_ROW_SENT_${config.sheetName.replace(/\s/g, '_')}`;
    const lastRowSent = Number(props.getProperty(stateKey));

    if (!lastRowSent) {
      props.setProperty(stateKey, String(lastRow));
      return;
    }

    for (let rowNumber = lastRowSent + 1; rowNumber <= lastRow; rowNumber += 1) {
      const firstCell = sheet.getRange(rowNumber, 1).getValue();
      if (!firstCell) continue;

      const rowUrl = `https://docs.google.com/spreadsheets/d/${config.sheetId}`
        + `/edit#gid=${config.sheetGid}&range=A${rowNumber}`;
      const message = `Новая строка добавлена:\n\n<a href="${rowUrl}">Перейти к строке</a>`;
      sendTelegramMessage(message);
    }

    props.setProperty(stateKey, String(lastRow));
  } finally {
    lock.releaseLock();
  }
}

function getUpdates() {
  const { telegramToken } = getConfig();
  const props = PropertiesService.getScriptProperties();
  const offset = Number(props.getProperty('TELEGRAM_OFFSET')) || 0;
  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${telegramToken}/getUpdates?offset=${offset + 1}`
  );
  const data = JSON.parse(response.getContentText());

  if (!data.ok || !data.result.length) return;

  const chatIds = JSON.parse(props.getProperty('CHAT_IDS') || '[]');

  data.result.forEach(update => {
    if (update.message && update.message.text === '/start') {
      const chatId = update.message.chat.id;
      if (!chatIds.includes(chatId)) {
        chatIds.push(chatId);
        sendTelegramMessageToUser(chatId, 'Вы подписались на уведомления.');
      }
    }
    props.setProperty('TELEGRAM_OFFSET', String(update.update_id));
  });

  props.setProperty('CHAT_IDS', JSON.stringify(chatIds));
}
