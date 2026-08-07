require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const BotClass = TelegramBot.default || TelegramBot;
const express = require('express');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ THIẾU BIẾN MÔI TRƯỜNG: Vui lòng cung cấp TELEGRAM_TOKEN và TELEGRAM_CHAT_ID');
    process.exit(1);
}

const bot = new BotClass(TELEGRAM_TOKEN, { polling: true });
const rssParser = new Parser();

let genAI = null;
if (GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const MENU_FILE = path.join(__dirname, 'menu.json');

// --- QUẢN LÝ BỘ NHỚ ---
let menus = [];
let globalOrders = {};

try {
    menus = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8'));
} catch (e) {
    console.error('Lỗi đọc menu.json', e);
}

try {
    if (fs.existsSync(ORDERS_FILE)) {
        globalOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    }
} catch (e) {
    console.error('Lỗi đọc orders.json', e);
    globalOrders = {};
}

function saveOrders() {
    try {
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(globalOrders, null, 2));
    } catch (e) {
        console.error('Lỗi ghi orders.json', e);
    }
}

// --- HÀM SCRAPING ---
async function fetchRealGoldPrice() {
    try {
        const response = await axios.get('https://webgia.com/gia-vang/', { timeout: 8000 });
        const html = response.data;
        const $ = cheerio.load(html);
        
        let buyPrice = '';
        let sellPrice = '';
        
        $('table tbody tr').each((i, el) => {
            const name = $(el).find('td').first().text().toLowerCase();
            if (name.includes('nhẫn') && name.includes('9999')) {
                const buy = $(el).find('td').eq(1).text().trim();
                const sell = $(el).find('td').eq(2).text().trim();
                if (buy && sell && !buyPrice) {
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
        return {
             title: 'Mock Data Nhẫn 9999',
             buy: '13.980.000',
             sell: '14.280.000',
             text: `💍 [BẢN TEST] Giá Vàng Nhẫn Trơn 9999 (1 Chỉ):\n- Mua vào: 13.980.000 VNĐ\n- Bán ra: 14.280.000 VNĐ`
        };
    }
}

async function fetchStockNews() {
    try {
        const feed = await rssParser.parseURL('https://cafef.vn/thi-truong-chung-khoan.rss');
        const news = feed.items.slice(0, 5).map((item, index) => `${index + 1}. ${item.title}`).join('\n');
        return news;
    } catch (error) {
        console.error('Lỗi cào tin:', error.message);
        return '1. Chứng khoán biến động mạnh.\n2. HPG tăng trần.\n3. MWG doanh thu tốt.\n4. Giá vàng lập đỉnh.\n5. Tỷ giá ổn định.';
    }
}

async function getAIAnalysis(goldData, newsText) {
    if (!genAI) {
        return "⚠️ Bạn chưa cấu hình GEMINI_API_KEY. Bot đã lấy được tin tức nhưng không thể phân tích được.";
    }
    
    try {
        let model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
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

        try {
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (e) {
            console.warn("Lỗi bản flash, chuyển sang gemini-pro", e.message);
            model = genAI.getGenerativeModel({ model: "gemini-pro" });
            const result = await model.generateContent(prompt);
            return result.response.text();
        }
    } catch (error) {
        console.error('Lỗi gọi AI:', error.message);
        return "❌ Có lỗi xảy ra khi gọi Trí Tuệ Nhân Tạo. Có thể do quá tải, xin hãy thử lại sau.";
    }
}


// --- XỬ LÝ LỆNH TELEGRAM VÀNG VÀ CHỨNG KHOÁN ---
bot.onText(/\/giavang/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, '⏳ Đang cào dữ liệu giá vàng mới nhất, chờ chút nhé...');
        const goldData = await fetchRealGoldPrice();
        const timeNow = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        await bot.sendMessage(chatId, `${goldData.text}\n- Thời gian: ${timeNow}`);
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\/tonghop/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, '⏳ Đang đi gom tin tức, xem giá vàng và nhờ chuyên gia AI phân tích... Hãy làm một ngụm trà, quá trình này mất khoảng 5-10 giây nhé! 🍵');
        
        const goldData = await fetchRealGoldPrice();
        const newsText = await fetchStockNews();
        const analysis = await getAIAnalysis(goldData, newsText);
        const timeNow = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        
        const finalMessage = `📊 BÁO CÁO TỔNG HỢP & NHẬN ĐỊNH (${timeNow})\n\n`
                           + `📰 TIN TỨC NỔI BẬT TRONG NGÀY:\n${newsText}\n\n`
                           + `💡 NHẬN ĐỊNH TỪ CHUYÊN GIA AI:\n${analysis}`;
                           
        if (finalMessage.length > 4000) {
            await bot.sendMessage(chatId, finalMessage.substring(0, 4000));
            await bot.sendMessage(chatId, finalMessage.substring(4000));
        } else {
            await bot.sendMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
        }
    } catch (err) {
        console.error(err);
    }
});


// --- XỬ LÝ LỆNH MENU GỌI MÓN ---
bot.onText(/\/menu/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        if (menus.length === 0) {
            return bot.sendMessage(chatId, '⚠ Hiện chưa có danh sách quán ăn nào. Admin vui lòng cấu hình menu.json.');
        }
        
        const inlineKeyboard = menus.map(menu => ([
            { text: menu.name, callback_data: `rest_${menu.id}` }
        ]));
        
        await bot.sendMessage(chatId, '🍽 **HÔM NAY ĂN GÌ?**\nBấm vào nút bên dưới để xem menu quán nhé:', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    } catch (e) {
        console.error(e);
    }
});

bot.on('callback_query', async (query) => {
    try {
        const chatId = query.message.chat.id;
        const data = query.data;
        const user = query.from.username || query.from.first_name || 'Khách';

        if (data.startsWith('rest_')) {
            const restId = data.replace('rest_', '');
            const menu = menus.find(m => m.id === restId);
            
            if (menu) {
                const inlineKeyboard = [];
                for (let i = 0; i < menu.items.length; i += 2) {
                    const row = [];
                    row.push({ text: menu.items[i].name, callback_data: `item_${restId}_${menu.items[i].id}` });
                    if (menu.items[i+1]) {
                        row.push({ text: menu.items[i+1].name, callback_data: `item_${restId}_${menu.items[i+1].id}` });
                    }
                    inlineKeyboard.push(row);
                }
                
                await bot.editMessageText(`👇 Mời chọn món tại **${menu.name}**:`, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: inlineKeyboard
                    }
                });
            }
        } else if (data.startsWith('item_')) {
            const parts = data.split('_');
            const restId = parts[1];
            const itemId = parts.slice(2).join('_');
            
            const menu = menus.find(m => m.id === restId);
            const item = menu?.items.find(i => i.id === itemId);
            
            if (item) {
                // Update in-memory storage
                if (!globalOrders[user]) globalOrders[user] = [];
                globalOrders[user].push(item.name);
                // Save to file
                saveOrders();
                
                await bot.answerCallbackQuery(query.id, { text: `✅ Đã thêm: ${item.name}` });
                await bot.sendMessage(chatId, `✅ @${user} vừa đặt: **${item.name}**`, { parse_mode: 'Markdown' });
            }
        }
    } catch (e) {
        console.error('Callback query error:', e);
    }
});

bot.onText(/\/ds/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        
        let hasOrders = false;
        for (const user in globalOrders) {
            if (globalOrders[user] && globalOrders[user].length > 0) {
                hasOrders = true;
                break;
            }
        }
        
        if (!hasOrders) {
            return bot.sendMessage(chatId, '📭 Hiện chưa có ai đặt món nào!');
        }
        
        let text = '📋 **DANH SÁCH ĐẶT CƠM**\n\n';
        let totalItems = {};
        
        for (const [user, items] of Object.entries(globalOrders)) {
            if (items.length > 0) {
                text += `👤 @${user}:\n`;
                items.forEach(item => {
                    text += `  - ${item}\n`;
                    totalItems[item] = (totalItems[item] || 0) + 1;
                });
            }
        }
        
        text += '\n🛒 **TỔNG HỢP ĐI ĐẶT GRAB:**\n';
        for (const [item, count] of Object.entries(totalItems)) {
            text += `- ${count} x ${item}\n`;
        }
        
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\/huy/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const user = msg.from.username || msg.from.first_name || 'Khách';
        
        if (globalOrders[user] && globalOrders[user].length > 0) {
            const removed = globalOrders[user].pop(); 
            saveOrders();
            await bot.sendMessage(chatId, `🗑 @${user} đã hủy món: **${removed}**`, { parse_mode: 'Markdown' });
        } else {
            await bot.sendMessage(chatId, `⚠ @${user} chưa đặt món nào để hủy!`);
        }
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\/chotdon/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        globalOrders = {};
        saveOrders();
        await bot.sendMessage(chatId, '✅ **Đã chốt đơn và reset lại danh sách.** Mọi người chuẩn bị ăn ngon nhé 😋', { parse_mode: 'Markdown' });
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\/id/, async (msg) => {
    try {
        await bot.sendMessage(msg.chat.id, `🆔 Chat ID của nhóm/đoạn chat này là: \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error(e);
    }
});

// --- LỆNH KHỞI ĐỘNG CƠ BẢN ---
bot.onText(/\/start/, async (msg) => {
    try {
        const helpText = `Xin chào! Tôi là Trợ Lý Văn Phòng 🤖\n\n`
                       + `📈 **Tài chính:**\n`
                       + `- /giavang: Xem giá vàng nhẫn 9999\n`
                       + `- /tonghop: AI nhận định chứng khoán (MWG, HPG, Vàng)\n\n`
                       + `🍱 **Ăn uống:**\n`
                       + `- /menu: Bấm nút để chọn món ăn trưa\n`
                       + `- /ds: Xem danh sách tổng hợp ai đã đặt món gì\n`
                       + `- /huy: Xóa món ăn bạn vừa bấm chọn nhầm\n`
                       + `- /chotdon: (Dành cho Admin) Xóa trắng danh sách để bắt đầu ngày mới.`;
        await bot.sendMessage(msg.chat.id, helpText);
    } catch (e) {
        console.error(e);
    }
});

cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Tới 8h sáng rồi, tự động gửi báo cáo...');
    try {
        const goldData = await fetchRealGoldPrice();
        const timeNow = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        bot.sendMessage(TELEGRAM_CHAT_ID, `🌅 CHÀO BUỔI SÁNG!\n${goldData.text}\n- Thời gian: ${timeNow}`);
    } catch (e) {
        console.error(e);
    }
});

const app = express();
app.get('/', (req, res) => {
    res.send('Bot Tài Chính & Cơm Trưa đang hoạt động!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Web server giả đang chạy trên port ${PORT}`);
    console.log('✅ Bot Telegram đã khởi động và đang online!');
});
