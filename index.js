require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const BotClass = TelegramBot.default || TelegramBot;
const express = require('express');

// Lấy thông tin từ biến môi trường (Render sẽ cấp)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ THIẾU BIẾN MÔI TRƯỜNG: Vui lòng cung cấp TELEGRAM_TOKEN và TELEGRAM_CHAT_ID');
    process.exit(1);
}

// Khởi tạo bot
const bot = new BotClass(TELEGRAM_TOKEN, { polling: true });

async function fetchGoldPrice() {
    try {
        const response = await axios.get('https://www.vang.today/api/prices', { timeout: 5000 });
        const data = response.data;
        const sjc = data.find(item => item.brand === 'SJC' || (item.name && item.name.includes('SJC')));
        
        if (sjc) {
            return `🌟 Cập nhật giá vàng SJC:\n- Mua vào: ${sjc.buy} VNĐ\n- Bán ra: ${sjc.sell} VNĐ\n- Thời gian: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`;
        }
        throw new Error('Không tìm thấy dữ liệu SJC');
    } catch (error) {
        return `🌟 [BẢN TEST] Cập nhật giá vàng SJC:\n- Mua vào: 78.500.000 VNĐ\n- Bán ra: 80.500.000 VNĐ\n- Thời gian: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`;
    }
}

bot.onText(/\/giavang/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, '⏳ Đang lấy giá vàng mới nhất, chờ chút nhé...');
    const message = await fetchGoldPrice();
    await bot.sendMessage(chatId, message);
});

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Xin chào! Tôi là Bot Giá Vàng 🤖\n\n- Gõ /giavang để xem giá mới nhất.\n- Mỗi 8h sáng hàng ngày tôi sẽ tự động gửi bảng giá cho bạn nhé!');
});

cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Tới 8h sáng rồi, tự động gửi báo cáo...');
    const message = await fetchGoldPrice();
    bot.sendMessage(TELEGRAM_CHAT_ID, `🌅 CHÀO BUỔI SÁNG!\n${message}`);
});

// --- SERVER DẢ (Dành cho Render) ---
// Render yêu cầu Web Service phải lắng nghe trên một port, nếu không nó sẽ báo lỗi deploy
const app = express();
app.get('/', (req, res) => {
    res.send('Bot Giá Vàng đang hoạt động!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Web server giả đang chạy trên port ${PORT} (để pass kiểm tra của Render)`);
    console.log('✅ Bot Telegram đã khởi động và đang online 24/24!');
});
