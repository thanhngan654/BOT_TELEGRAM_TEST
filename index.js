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
const DEBTS_FILE = path.join(__dirname, 'debts.json');

// --- QUẢN LÝ BỘ NHỚ ---
let menus = [];
let globalOrders = {}; // Dữ liệu mới: { restId: { restName: 'A', users: { username: [ {name, price} ] } } }
let debts = {};

try { menus = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8')); } catch (e) {}
try { if (fs.existsSync(ORDERS_FILE)) globalOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch (e) {}
try { if (fs.existsSync(DEBTS_FILE)) debts = JSON.parse(fs.readFileSync(DEBTS_FILE, 'utf8')); } catch (e) {}

function saveOrders() { fs.writeFileSync(ORDERS_FILE, JSON.stringify(globalOrders, null, 2)); }
function saveDebts() { fs.writeFileSync(DEBTS_FILE, JSON.stringify(debts, null, 2)); }

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
            // Loại bỏ parse_mode để tránh sập bot do Markdown lỗi từ AI
            await bot.sendMessage(chatId, finalMessage);
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
        
        await bot.sendMessage(chatId, '🍽 <b>HÔM NAY ĂN GÌ?</b>\nBấm vào nút bên dưới để xem menu quán nhé:', {
            parse_mode: 'HTML',
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
                for (let i = 0; i < menu.items.length; i++) {
                    const item = menu.items[i];
                    
                    // Tạo chữ cho nút: [Giá] Tên món
                    let btnText = item.name;
                    if (item.price) {
                        // Rút gọn giá: 25000 -> 25k
                        const priceK = (item.price / 1000) + 'k';
                        btnText = `[${priceK}] ${item.name}`;
                    }
                    
                    inlineKeyboard.push([{ text: btnText, callback_data: `i_${restId}_${item.id}` }]);
                }
                
                // Tạo nội dung tin nhắn kèm link Grab
                let textCaption = `👇 Mời chọn món tại <b>${menu.name}</b>:`;
                if (menu.url) {
                    textCaption += `\n🔗 <a href="${menu.url}">Xem ảnh/món ăn trên ứng dụng Grab</a>`;
                }

                // Nếu có ảnh banner thì xóa tin nhắn cũ, gửi tin ảnh mới
                if (menu.banner_image) {
                    try { await bot.deleteMessage(chatId, query.message.message_id); } catch(e) {}
                    try {
                        await bot.sendPhoto(chatId, menu.banner_image, {
                            caption: textCaption,
                            parse_mode: 'HTML',
                            reply_markup: { inline_keyboard: inlineKeyboard }
                        });
                    } catch (err) {
                        console.error('Lỗi gửi ảnh banner, chuyển sang dạng text:', err.message);
                        // Fallback: Gửi tin nhắn text nếu ảnh bị lỗi (Vd: ảnh SVG)
                        await bot.sendMessage(chatId, textCaption, {
                            parse_mode: 'HTML',
                            reply_markup: { inline_keyboard: inlineKeyboard }
                        });
                    }
                } else {
                    // Nếu không có ảnh thì edit text như bình thường
                    await bot.editMessageText(textCaption, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: inlineKeyboard
                        }
                    });
                }
            }
        } else if (data.startsWith('i_')) {
            const parts = data.split('_');
            const restId = parts[1];
            const itemId = parts.slice(2).join('_');
            
            const menu = menus.find(m => m.id === restId);
            const item = menu?.items.find(i => i.id === itemId);
            
            if (item && menu) {
                if (!globalOrders[restId]) globalOrders[restId] = { restName: menu.name, users: {} };
                if (!globalOrders[restId].users[user]) globalOrders[restId].users[user] = [];
                
                globalOrders[restId].users[user].push({ name: item.name, price: item.price || 0 });
                saveOrders();
                
                await bot.answerCallbackQuery(query.id, { text: `✅ Đã thêm: ${item.name}` });
                await bot.sendMessage(chatId, `✅ @${user} vừa đặt <b>${item.name}</b> tại quán <b>${menu.name}</b>`, { parse_mode: 'HTML' });
            }
        } else if (data.startsWith('pay_')) {
            const userOwe = data.replace('pay_', '');
            const amount = debts[userOwe];
            
            if (!amount || amount <= 0) {
                return bot.answerCallbackQuery(query.id, { text: `✅ @${userOwe} đã thanh toán xong rồi!`, show_alert: true });
            }
            
            const bankId = 'MB'; // MB Bank
            const accountNo = '03709868';
            const accountName = encodeURIComponent('NGUYEN THANH NGAN');
            const addInfo = encodeURIComponent(`${userOwe} thanh toan`);
            const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${amount}&addInfo=${addInfo}&accountName=${accountName}`;
            
            const inlineConfirm = [
                [{ text: `✅ Admin Xác Nhận: @${userOwe} Đã Chuyển ${amount.toLocaleString()}đ`, callback_data: `confirm_${userOwe}` }]
            ];
            
            await bot.sendPhoto(chatId, qrUrl, {
                caption: `📸 Mã QR thanh toán tự động cho <b>@${userOwe}</b>\n💰 Số tiền nợ: <b>${amount.toLocaleString()}đ</b>`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: inlineConfirm }
            });
            await bot.answerCallbackQuery(query.id);
            
        } else if (data.startsWith('confirm_')) {
            const userOwe = data.replace('confirm_', '');
            
            if (!debts[userOwe] || debts[userOwe] <= 0) {
                return bot.answerCallbackQuery(query.id, { text: `⚠ Người này đã được xác nhận trước đó rồi!`, show_alert: true });
            }
            
            debts[userOwe] = 0; // Xóa nợ
            saveDebts();
            
            await bot.answerCallbackQuery(query.id, { text: `✅ Đã xác nhận thanh toán!` });
            
            // Xóa nút bấm xác nhận để tránh bấm 2 lần
            await bot.editMessageCaption(`✅ <b>Admin đã xác nhận @${userOwe} thanh toán xong!</b>`, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
            });
        }
    } catch (e) {
        console.error('Callback query error:', e);
    }
});

bot.onText(/\/ds/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        
        if (Object.keys(globalOrders).length === 0) {
            return bot.sendMessage(chatId, '📭 Hiện chưa có ai đặt món nào!');
        }
        
        let text = '📋 <b>DANH SÁCH ĐẶT CƠM (CHƯA CHỐT)</b>\n\n';
        let restIndex = 1;
        
        for (const [restId, restData] of Object.entries(globalOrders)) {
            // Fix crash if globalOrders contains old data structure
            if (!restData || typeof restData.users === 'undefined') {
                globalOrders = {};
                saveOrders();
                return bot.sendMessage(chatId, '🧹 Giỏ hàng cũ không tương thích đã được dọn dẹp! Vui lòng chọn món lại từ menu.');
            }
            let restTotal = 0;
            text += `🏪 <b>[ID: ${restIndex}] ${restData.restName}</b>\n`;
            
            for (const [user, items] of Object.entries(restData.users)) {
                if (items.length > 0) {
                    let userTotal = 0;
                    text += `👤 @${user}:\n`;
                    items.forEach(item => {
                        text += `  - ${item.name} (${item.price.toLocaleString()}đ)\n`;
                        userTotal += item.price;
                    });
                    restTotal += userTotal;
                }
            }
            text += `👉 <b>Tổng gốc quán này: ${restTotal.toLocaleString()}đ</b>\n`;
            text += `📝 <i>Chốt đơn quán này: /chotdon ${restIndex} [Tổng_Tiền_Đã_Giảm]</i>\n\n`;
            restIndex++;
        }
        
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\/huy/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const user = msg.from.username || msg.from.first_name || 'Khách';
        
        let removedItem = null;
        let removedRestName = '';
        
        for (const restId in globalOrders) {
            if (!globalOrders[restId] || typeof globalOrders[restId].users === 'undefined') {
                globalOrders = {};
                saveOrders();
                return bot.sendMessage(chatId, '🧹 Giỏ hàng cũ không tương thích đã được dọn dẹp! Vui lòng chọn món lại từ menu.');
            }
            if (globalOrders[restId].users[user] && globalOrders[restId].users[user].length > 0) {
                removedItem = globalOrders[restId].users[user].pop();
                removedRestName = globalOrders[restId].restName;
                
                if (globalOrders[restId].users[user].length === 0) delete globalOrders[restId].users[user];
                if (Object.keys(globalOrders[restId].users).length === 0) delete globalOrders[restId];
                break;
            }
        }
        
        if (removedItem) {
            saveOrders();
            await bot.sendMessage(chatId, `🗑 @${user} đã hủy món: <b>${removedItem.name}</b> (tại ${removedRestName})`, { parse_mode: 'HTML' });
        } else {
            await bot.sendMessage(chatId, `⚠ @${user} chưa đặt món nào để hủy!`);
        }
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\/chotdon(?:\s+(\d+)\s+(\d+))?/, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        
        if (!match[1] || !match[2]) {
            return bot.sendMessage(chatId, '⚠ Cú pháp sai! Vui lòng dùng: `/chotdon <ID_Quán> <Số_tiền_thực_tế>`\nVí dụ: `/chotdon 1 100000`', { parse_mode: 'Markdown' });
        }
        
        const targetIndex = parseInt(match[1]);
        const finalPrice = parseInt(match[2]);
        
        const restIds = Object.keys(globalOrders);
        if (targetIndex < 1 || targetIndex > restIds.length) {
            return bot.sendMessage(chatId, `⚠ Không tìm thấy ID quán là ${targetIndex}! Gõ /ds để xem.`);
        }
        
        const restId = restIds[targetIndex - 1];
        const restData = globalOrders[restId];
        if (!restData || typeof restData.users === 'undefined') {
            globalOrders = {};
            saveOrders();
            return bot.sendMessage(chatId, '🧹 Giỏ hàng cũ không tương thích đã được dọn dẹp! Vui lòng chọn món lại từ menu.');
        }
        
        let originalTotal = 0;
        let userTotals = {};
        
        for (const [user, items] of Object.entries(restData.users)) {
            let uTotal = items.reduce((sum, item) => sum + item.price, 0);
            userTotals[user] = uTotal;
            originalTotal += uTotal;
        }
        
        if (originalTotal === 0) {
            return bot.sendMessage(chatId, `⚠ Quán này không có đơn.`);
        }
        
        const ratio = finalPrice / originalTotal;
        
        let reportText = `✅ <b>ĐÃ CHỐT ĐƠN: ${restData.restName}</b>\n`;
        reportText += `💰 Tổng gốc: ${originalTotal.toLocaleString()}đ -> <b>Thực thu: ${finalPrice.toLocaleString()}đ</b> (Tỷ lệ thực trả ~$((ratio * 100).toFixed(1)}%)\n\n`;
        
        for (const [user, uTotal] of Object.entries(userTotals)) {
            if (uTotal > 0) {
                const finalUserDebt = Math.round(uTotal * ratio);
                debts[user] = (debts[user] || 0) + finalUserDebt;
                reportText += `👤 @${user}: nợ <b>${finalUserDebt.toLocaleString()}đ</b>\n`;
            }
        }
        
        reportText += `\n<i>Số tiền nợ đã cộng vào danh sách. Gõ /rc để thanh toán!</i>`;
        
        delete globalOrders[restId];
        saveOrders();
        saveDebts();
        
        await bot.sendMessage(chatId, reportText, { parse_mode: 'HTML' });
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\/rc/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        
        const debtors = Object.keys(debts).filter(u => debts[u] > 0);
        if (debtors.length === 0) {
            return bot.sendMessage(chatId, '🎉 Hiện tại không có ai nợ tiền cơm!');
        }
        
        let text = '💸 <b>DANH SÁCH NHẮC NỢ (Click để lấy mã QR chuyển khoản):</b>\n\n';
        
        const inlineKeyboard = debtors.map(user => ([
            { text: `Thanh toán cho @${user} (${debts[user].toLocaleString()}đ)`, callback_data: `pay_${user}` }
        ]));
        
        await bot.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\/id/, async (msg) => {
    try {
        await bot.sendMessage(msg.chat.id, `🆔 Chat ID của nhóm/đoạn chat này là: <code>${msg.chat.id}</code>`, { parse_mode: 'HTML' });
    } catch (e) {
        console.error(e);
    }
});

// --- LỆNH KHỞI ĐỘNG CƠ BẢN ---
bot.onText(/\/start/, async (msg) => {
    try {
        const helpText = `Xin chào! Tôi là Trợ Lý Văn Phòng 🤖\n\n`
                       + `📈 <b>Tài chính:</b>\n`
                       + `- /giavang: Xem giá vàng nhẫn 9999\n`
                       + `- /tonghop: AI nhận định chứng khoán (MWG, HPG, Vàng)\n\n`
                       + `🍱 <b>Ăn uống:</b>\n`
                       + `- /menu: Bấm nút để chọn món ăn trưa\n`
                       + `- /ds: Xem danh sách tổng hợp ai đã đặt món gì\n`
                       + `- /huy: Xóa món ăn bạn vừa bấm chọn nhầm\n`
                       + `- /chotdon <ID> <Tiền>: (Admin) Chốt hóa đơn của 1 quán và chia đều mã giảm giá
                       - /rc: Hiển thị danh sách nợ & Mã QR thanh toán.`;
        await bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'HTML' });
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
const cors = require('cors');
app.use(cors());
app.use(express.json()); // Hỗ trợ đọc body dạng JSON

app.get('/', (req, res) => {
    res.send('Bot Tài Chính & Cơm Trưa đang hoạt động!');
});

app.get('/setup', (req, res) => {
    const path = require('path');
    res.sendFile(path.join(__dirname, 'setup_bookmarklet.html'));
});

// API Đẩy thực đơn từ Tool bên ngoài vào
app.post('/api/menu', (req, res) => {
    try {
        const secretKey = req.body.secret_key;
        if (secretKey !== 'sieubot123') {
            return res.status(403).json({ error: 'Sai mật khẩu bảo mật' });
        }
        
        const newMenu = req.body;
        // Kiểm tra dữ liệu hợp lệ
        if (!newMenu.id || !newMenu.name || !newMenu.items) {
            return res.status(400).json({ error: 'Thiếu dữ liệu id, name, hoặc items' });
        }
        
        // Cập nhật vào mảng menus trong RAM
        const existingIndex = menus.findIndex(m => m.id === newMenu.id);
        if (existingIndex !== -1) {
            menus[existingIndex] = newMenu; // Cập nhật quán cũ
        } else {
            menus.push(newMenu); // Quán mới
        }
        
        // Lưu ra ổ cứng
        fs.writeFileSync(MENU_FILE, JSON.stringify(menus, null, 2));
        
        res.json({ success: true, message: `Đã cập nhật menu cho ${newMenu.name}` });
    } catch (e) {
        console.error('Lỗi API Menu:', e);
        res.status(500).json({ error: 'Lỗi server nội bộ' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Web server giả đang chạy trên port ${PORT}`);
    console.log('✅ Bot Telegram đã khởi động và đang online!');
});
