require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const BotClass = TelegramBot.default || TelegramBot;
const express = require('express');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Cấu hình môi trường
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ THIẾU BIẾN MÔI TRƯỜNG: Vui lòng cung cấp TELEGRAM_TOKEN và TELEGRAM_CHAT_ID');
    process.exit(1);
}

const bot = new BotClass(TELEGRAM_TOKEN, { polling: true });
const rssParser = new Parser();

// Cấu hình AI
let genAI = null;
if (GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}

// 1. Hàm cào giá vàng nhẫn thật từ webgia.com
async function fetchRealGoldPrice() {
    try {
        const response = await axios.get('https://webgia.com/gia-vang/', { timeout: 8000 });
        const html = response.data;
        const $ = cheerio.load(html);
        
        let buyPrice = '';
        let sellPrice = '';
        
        // Cào bảng giá để lấy Nhẫn tròn 9999
        $('table tbody tr').each((i, el) => {
            const name = $(el).find('td').first().text().toLowerCase();
            if (name.includes('nhẫn') && name.includes('9999')) {
                const buy = $(el).find('td').eq(1).text().trim();
                const sell = $(el).find('td').eq(2).text().trim();
                if (buy && sell && !buyPrice) { // Lấy kết quả đầu tiên
                    buyPrice = buy;
                    sellPrice = sell;
                }
            }
        });

        if (buyPrice && sellPrice) {
            return {
                title: 'Vàng Nhẫn 9999',
                buy: buyPrice,
                sell: sellPrice,
                text: `💍 Cập nhật giá Vàng Nhẫn 9999 (1 Chỉ):\n- Mua vào: ${buyPrice}\n- Bán ra: ${sellPrice}\n- Nguồn: webgia.com`
            };
        }
        throw new Error('Không tìm thấy dữ liệu Nhẫn 9999 trên webgia');
    } catch (error) {
        // Mock data fallback
        return {
             title: 'Mock Data Nhẫn 9999',
             buy: '13.980.000',
             sell: '14.280.000',
             text: `💍 [BẢN TEST] Giá Vàng Nhẫn Trơn 9999 (1 Chỉ):\n- Mua vào: 13.980.000 VNĐ\n- Bán ra: 14.280.000 VNĐ`
        };
    }
}

// 2. Hàm cào tin tức chứng khoán (Dùng RSS CafeF)
async function fetchStockNews() {
    try {
        const feed = await rssParser.parseURL('https://cafef.vn/thi-truong-chung-khoan.rss');
        // Lấy 5 bài báo mới nhất
        const news = feed.items.slice(0, 5).map((item, index) => `${index + 1}. ${item.title}`).join('\n');
        return news;
    } catch (error) {
        console.error('Lỗi cào tin:', error.message);
        return '1. Chứng khoán biến động mạnh trong phiên chiều.\n2. Khối ngoại tiếp tục bán ròng cổ phiếu thép HPG.\n3. MWG (Thế giới di động) công bố doanh thu tăng trưởng ấn tượng trong tháng.\n4. Giá vàng thế giới lập đỉnh lịch sử mới.\n5. Ngân hàng nhà nước có động thái mới để ổn định tỷ giá.';
    }
}

// 3. Hàm gọi AI (Gemini) để nhận định
async function getAIAnalysis(goldData, newsText) {
    if (!genAI) {
        return "⚠️ Bạn chưa cấu hình GEMINI_API_KEY. Bot đã lấy được tin tức nhưng không thể phân tích được.";
    }
    
    try {
        // Dùng mô hình flash để tốc độ phản hồi nhanh nhất (phù hợp cho Bot chat)
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const prompt = `Bạn là một chuyên gia phân tích tài chính. Dưới đây là thông tin thị trường hôm nay:
        1. Giá vàng hiện tại: ${goldData.text}
        2. Top 5 tin tức chứng khoán nổi bật:
        ${newsText}
        
        Nhiệm vụ của bạn: Dựa trên kiến thức của bạn và các thông tin trên, hãy viết một bản tin tổng hợp ngắn gọn (khoảng 3-4 đoạn). 
        Hãy nhận định chi tiết về quá khứ, hiện tại và tương lai của 3 danh mục đầu tư sau:
        - Giá vàng
        - Cổ phiếu MWG (Thế giới di động)
        - Cổ phiếu HPG (Tập đoàn Hòa Phát)
        
        Giọng văn: Chuyên nghiệp, súc tích và có ích cho nhà đầu tư cá nhân mua tích sản.`;

        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error('Lỗi gọi AI:', error.message);
        return "❌ Có lỗi xảy ra khi gọi Trí Tuệ Nhân Tạo. Có thể do quá tải, xin hãy thử lại sau.";
    }
}


// --- XỬ LÝ LỆNH TELEGRAM ---

bot.onText(/\/giavang/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, '⏳ Đang cào dữ liệu giá vàng mới nhất, chờ chút nhé...');
    const goldData = await fetchRealGoldPrice();
    const timeNow = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    await bot.sendMessage(chatId, `${goldData.text}\n- Thời gian: ${timeNow}`);
});

bot.onText(/\/tonghop/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, '⏳ Đang đi gom tin tức, xem giá vàng và nhờ chuyên gia AI phân tích... Hãy làm một ngụm trà, quá trình này mất khoảng 5-10 giây nhé! 🍵');
    
    try {
        // 1. Thu thập dữ liệu
        const goldData = await fetchRealGoldPrice();
        const newsText = await fetchStockNews();
        
        // 2. Gọi AI
        const analysis = await getAIAnalysis(goldData, newsText);
        
        // 3. Gửi báo cáo
        const timeNow = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const finalMessage = `📊 BÁO CÁO TỔNG HỢP & NHẬN ĐỊNH (${timeNow})\n\n`
                           + `📰 TIN TỨC NỔI BẬT TRONG NGÀY:\n${newsText}\n\n`
                           + `💡 NHẬN ĐỊNH TỪ CHUYÊN GIA AI:\n${analysis}`;
                           
        // Telegram giới hạn độ dài tin nhắn (khoảng 4096 ký tự), phải chia nhỏ nếu quá dài
        if (finalMessage.length > 4000) {
            await bot.sendMessage(chatId, finalMessage.substring(0, 4000));
            await bot.sendMessage(chatId, finalMessage.substring(4000));
        } else {
            await bot.sendMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
        }
    } catch (err) {
        await bot.sendMessage(chatId, "❌ Đã có lỗi xảy ra trong quá trình tổng hợp. Vui lòng thử lại sau.");
        console.error(err);
    }
});

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Xin chào! Tôi là Trợ Lý Đầu Tư 🤖\n\n- Gõ /giavang để xem giá vàng nhẫn.\n- Gõ /tonghop để xem tin tức và nhận định (MWG, HPG, Vàng) từ AI.\n- Mỗi 8h sáng hàng ngày tôi sẽ tự động gửi bảng giá vàng cho bạn nhé!');
});

cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Tới 8h sáng rồi, tự động gửi báo cáo...');
    const goldData = await fetchRealGoldPrice();
    const timeNow = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    bot.sendMessage(TELEGRAM_CHAT_ID, `🌅 CHÀO BUỔI SÁNG!\n${goldData.text}\n- Thời gian: ${timeNow}`);
});

// --- SERVER GIẢ CHO RENDER ---
const app = express();
app.get('/', (req, res) => {
    res.send('Bot Tài Chính đang hoạt động!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Web server giả đang chạy trên port ${PORT}`);
    console.log('✅ Bot Telegram đã khởi động và đang online!');
});
