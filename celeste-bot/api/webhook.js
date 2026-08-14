const MENU = require("../menu.js");

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Уникальный маркер, которым мы прячем данные заказа внутри текста
// сообщения-вопроса о примечании. Когда менеджер отвечает на это
// сообщение (reply), мы читаем маркер из reply_to_message и
// восстанавливаем заказ — без базы данных и без сессий.
const MARK = "\u241FORDER\u241F";

async function tg(method, payload) {
  const res = await fetch(`${API_URL}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function money(n) {
  return `${n} AZN`;
}

// ---------- Клавиатуры ----------

function categoriesKeyboard() {
  return {
    inline_keyboard: MENU.map((cat, ci) => [
      { text: cat.category, callback_data: `c:${ci}` },
    ]),
  };
}

function itemsKeyboard(ci) {
  const cat = MENU[ci];
  const rows = cat.items.map((item, ii) => [
    { text: `${item.name} — ${money(item.price)}`, callback_data: `i:${ci}:${ii}` },
  ]);
  rows.push([{ text: "⬅️ Назад к категориям", callback_data: "back" }]);
  return { inline_keyboard: rows };
}

function qtyKeyboard(ci, ii, qty) {
  return {
    inline_keyboard: [
      [
        { text: "➖", callback_data: `q:${ci}:${ii}:${qty}:-1` },
        { text: `${qty} шт`, callback_data: "noop" },
        { text: "➕", callback_data: `q:${ci}:${ii}:${qty}:1` },
      ],
      [{ text: "✅ Далее", callback_data: `ok:${ci}:${ii}:${qty}` }],
      [{ text: "⬅️ Назад к позициям", callback_data: `c:${ci}` }],
    ],
  };
}

// ---------- Форматирование ----------

function orderSummaryText(ci, ii, qty) {
  const cat = MENU[ci];
  const item = cat.items[ii];
  const total = item.price * qty;
  const noteHint = cat.note ? `\n\n${cat.note}` : "";
  return (
    `📋 Проверь заказ:\n\n` +
    `${cat.category}\n${item.name}\nКоличество: ${qty}\nСумма: ${money(total)}` +
    noteHint
  );
}

function askNoteText(ci, ii, qty) {
  // Видимая часть — обычный вопрос. Невидимая (маркер + json) —
  // техническая, чтобы восстановить заказ из ответа менеджера.
  const visible =
    `✍️ Напиши примечание к заказу (данные клиента, вкусы, дата/время, пожелания).\n` +
    `Если примечаний нет — отправь "-".`;
  return `${visible}\n\n${MARK}${JSON.stringify({ c: ci, i: ii, q: qty })}`;
}

function finalCard(ci, ii, qty, note, managerName) {
  const cat = MENU[ci];
  const item = cat.items[ii];
  const total = item.price * qty;
  const now = new Date().toLocaleString("ru-RU", {
    timeZone: "Asia/Baku",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    `🆕 <b>Новый заказ — Céleste</b>\n\n` +
    `📦 <b>Категория:</b> ${cat.category}\n` +
    `🍰 <b>Позиция:</b> ${item.name}\n` +
    `🔢 <b>Количество:</b> ${qty}\n` +
    `💰 <b>Сумма:</b> ${money(total)}\n\n` +
    `📝 <b>Примечание:</b> ${note}\n\n` +
    `👤 <b>Менеджер:</b> ${managerName}\n` +
    `🕐 <b>Время:</b> ${now}`
  );
}

// ---------- Handler ----------

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(200).send("Céleste bot is running");
    return;
  }

  const update = req.body;

  try {
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id;
      const messageId = cq.message.message_id;
      const data = cq.data;

      if (data === "noop") {
        await tg("answerCallbackQuery", { callback_query_id: cq.id });
        return res.status(200).end();
      }

      if (data === "back") {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "Выбери категорию:",
          reply_markup: categoriesKeyboard(),
        });
      } else if (data.startsWith("c:")) {
        const [, ci] = data.split(":").map(Number);
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: `${MENU[ci].category}\nВыбери позицию:`,
          reply_markup: itemsKeyboard(ci),
        });
      } else if (data.startsWith("i:")) {
        const [, ci, ii] = data.split(":").map(Number);
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: orderSummaryText(ci, ii, 1),
          reply_markup: qtyKeyboard(ci, ii, 1),
        });
      } else if (data.startsWith("q:")) {
        const [, ci, ii, qtyStr, deltaStr] = data.split(":");
        let qty = Number(qtyStr) + Number(deltaStr);
        if (qty < 1) qty = 1;
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: orderSummaryText(Number(ci), Number(ii), qty),
          reply_markup: qtyKeyboard(Number(ci), Number(ii), qty),
        });
      } else if (data.startsWith("ok:")) {
        const [, ci, ii, qty] = data.split(":").map(Number);
        await tg("sendMessage", {
          chat_id: chatId,
          text: askNoteText(ci, ii, qty),
          reply_markup: { force_reply: true },
        });
      }

      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      return res.status(200).end();
    }

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = (msg.text || "").trim();

      // Ответ менеджера на вопрос о примечании -> собираем финальный заказ
      if (msg.reply_to_message && msg.reply_to_message.text && msg.reply_to_message.text.includes(MARK)) {
        const raw = msg.reply_to_message.text.split(MARK)[1];
        const { c: ci, i: ii, q: qty } = JSON.parse(raw);
        const note = text || "-";
        const manager =
          (msg.from.username && `@${msg.from.username}`) ||
          [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ");

        await tg("sendMessage", {
          chat_id: GROUP_CHAT_ID,
          text: finalCard(ci, ii, qty, note, manager),
          parse_mode: "HTML",
        });

        await tg("sendMessage", {
          chat_id: chatId,
          text: "✅ Заказ отправлен в группу!",
        });

        return res.status(200).end();
      }

      if (text === "/start" || text === "/order" || text === "Новый заказ") {
        await tg("sendMessage", {
          chat_id: chatId,
          text: "Céleste — оформление заказа 🍮\n\nВыбери категорию:",
          reply_markup: categoriesKeyboard(),
        });
        return res.status(200).end();
      }

      // Любой другой текст без контекста — подсказка
      await tg("sendMessage", {
        chat_id: chatId,
        text: "Напиши /order, чтобы начать новый заказ.",
      });
    }

    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(200).end(); // Telegram шлёт повторно при ошибке — отвечаем 200 в любом случае
  }
};
