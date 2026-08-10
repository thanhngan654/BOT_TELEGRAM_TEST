require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const BotClass = TelegramBot.default || TelegramBot;
const express = require('express');
const fs = require('fs');
const path = require('path');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ THIẾU BIẾN MÔI TRƯỜNG: Vui lòng cung cấp TELEGRAM_TOKEN và TELEGRAM_CHAT_ID');
    process.exit(1);
}

const bot = new BotClass(TELEGRAM_TOKEN, { polling: true });

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const MENU_FILE = path.join(__dirname, 'menu.json');
const DEBTS_FILE = path.join(__dirname, 'debts.json');

const db = require('./db');

// --- QUẢN LÝ BỘ NHỚ ---
let menus = [];
let globalOrders = {}; // Dữ liệu mới: { restId: { restName: 'A', users: { username: [ {name, price} ] } } }
let debts = {};
let footballEvent = { isActive: false, isLocked: false, users: {} };

async function startup() {
    await db.initDB();
    menus = await db.getKV('menus', []);
    globalOrders = await db.getKV('globalOrders', {});
    debts = await db.getDebts();
    
    // Migrate từ file cũ lên DB (nếu DB đang rỗng)
    if (menus.length === 0 && fs.existsSync(MENU_FILE)) {
        try { menus = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8')); db.setKV('menus', menus); } catch(e){}
    }
    if (Object.keys(globalOrders).length === 0 && fs.existsSync(ORDERS_FILE)) {
        try { globalOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); db.setKV('globalOrders', globalOrders); } catch(e){}
    }
    if (Object.keys(debts).length === 0 && fs.existsSync(DEBTS_FILE)) {
        try { debts = JSON.parse(fs.readFileSync(DEBTS_FILE, 'utf8')); db.saveDebts(debts); } catch(e){}
    }
    
    // Load Football State
    try {
        const stateRes = await db.query('SELECT * FROM football_state WHERE id = 1');
        if (stateRes.rows.length > 0) {
            footballEvent.isActive = stateRes.rows[0].is_active;
            footballEvent.isLocked = stateRes.rows[0].is_locked;
        }
        const attRes = await db.query('SELECT * FROM football_attendance');
        for (const row of attRes.rows) {
            footballEvent.users[row.username] = row.slots;
        }
    } catch(e) { console.error('Lỗi load football state', e); }
}
startup();

function saveOrders() { db.setKV('globalOrders', globalOrders); }
function saveDebts() { db.saveDebts(debts); }

async function saveFootball() {
    if (!process.env.DATABASE_URL) return;
    try {
        await db.query('UPDATE football_state SET is_active = $1, is_locked = $2 WHERE id = 1', [footballEvent.isActive, footballEvent.isLocked]);
        await db.query('BEGIN');
        await db.query('DELETE FROM football_attendance');
        for (const [user, slots] of Object.entries(footballEvent.users)) {
            await db.query('INSERT INTO football_attendance (username, slots) VALUES ($1, $2)', [user, slots]);
        }
        await db.query('COMMIT');
    } catch(e) {
        await db.query('ROLLBACK');
        console.error(e);
    }
}



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
        // Football handling
        if (data === 'fb_add' || data === 'fb_cancel') {
            if (footballEvent.isLocked) {
                return bot.answerCallbackQuery(query.id, { text: 'Trận bóng đã chốt!', show_alert: true });
            }
            if (data === 'fb_add') {
                footballEvent.users[user] = (footballEvent.users[user] || 0) + 1;
                saveFootball();
                return bot.answerCallbackQuery(query.id, { text: `Đã ghi nhận +1 cho ${user}` });
            }
            if (data === 'fb_cancel') {
                delete footballEvent.users[user];
                saveFootball();
                return bot.answerCallbackQuery(query.id, { text: `Đã hủy điểm danh của ${user}` });
            }
        }

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
                
                const menuIndex = menus.findIndex(m => m.id === restId) + 1;
                let textCaption = `👇 <b>[ID: ${menuIndex}]</b> Mời chọn món tại <b>${menu.name}</b>:`;
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
                [{ text: `💸 Bấm vào đây nếu bạn đã chuyển khoản xong`, callback_data: `confirm_${userOwe}` }]
            ];
            
            await bot.sendPhoto(chatId, qrUrl, {
                caption: `📸 Mã QR thanh toán tự động cho <b>@${userOwe}</b>\n💰 Số tiền nợ: <b>${amount.toLocaleString()}đ</b>`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: inlineConfirm }
            });
            await bot.answerCallbackQuery(query.id);
            
        } else if (data.startsWith('confirm_')) {
            const userOwe = data.replace('confirm_', '');
            const clicker = query.from.username || query.from.first_name || 'Khách';
            
            if (!debts[userOwe] || debts[userOwe] <= 0) {
                return bot.answerCallbackQuery(query.id, { text: `⚠ Quá trình thanh toán này đã được ghi nhận rồi!`, show_alert: true });
            }
            
            debts[userOwe] = 0; // Xóa nợ
            saveDebts();
            
            await bot.answerCallbackQuery(query.id, { text: `✅ Đã ghi nhận thanh toán!` });
            
            // Xóa nút bấm xác nhận để tránh bấm 2 lần
            await bot.editMessageCaption(`✅ <b>@${clicker} đã báo cáo là @${userOwe} đã chuyển khoản xong!</b>`, {
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
        
        for (const [restId, restData] of Object.entries(globalOrders)) {
            // Fix crash if globalOrders contains old data structure
            if (!restData || typeof restData.users === 'undefined') {
                globalOrders = {};
                saveOrders();
                return bot.sendMessage(chatId, '🧹 Giỏ hàng cũ không tương thích đã được dọn dẹp! Vui lòng chọn món lại từ menu.');
            }
            let restTotal = 0;
            const menuIndex = menus.findIndex(m => m.id === restId) + 1;
            text += `🏪 <b>[ID: ${menuIndex}] ${restData.restName}</b>\n`;
            
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
            text += `📝 <i>Chốt đơn quán này: /chotdon ${menuIndex} [Tổng_Tiền_Đã_Giảm]</i>\n\n`;
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
        
        const menu = menus[targetIndex - 1];
        if (!menu) {
            return bot.sendMessage(chatId, `⚠ Không tìm thấy ID quán là ${targetIndex}! Gõ /menu để xem danh sách ID hợp lệ.`);
        }
        
        const restId = menu.id;
        const restData = globalOrders[restId];
        if (!restData || typeof restData.users === 'undefined') {
            return bot.sendMessage(chatId, `⚠ Quán này chưa có ai đặt món hoặc dữ liệu đã bị dọn dẹp.`);
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

bot.onText(/\/del(?:\s+(\d+))?/, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        
        if (!match[1]) {
            return bot.sendMessage(chatId, '⚠ Cú pháp sai! Vui lòng dùng: `/del <ID_Quán>`\nVí dụ: `/del 1`', { parse_mode: 'Markdown' });
        }
        
        const targetIndex = parseInt(match[1]);
        if (targetIndex < 1 || targetIndex > menus.length) {
            return bot.sendMessage(chatId, `⚠ Không tìm thấy ID quán là ${targetIndex}! Gõ /menu để xem danh sách.`);
        }
        
        const deletedMenu = menus.splice(targetIndex - 1, 1)[0];
        fs.writeFileSync(MENU_FILE, JSON.stringify(menus, null, 2));
        
        await bot.sendMessage(chatId, `🗑 <b>Đã xóa quán:</b> ${deletedMenu.name} (ID: ${targetIndex}) khỏi Menu!`, { parse_mode: 'HTML' });
    } catch (e) {
        console.error(e);
    }
});

// --- LỆNH KHỞI ĐỘNG CƠ BẢN ---
bot.onText(/\/start/, async (msg) => {
    try {
        const helpText = `Xin chào! Tôi là Trợ Lý Đặt Cơm 🤖\n\n`
                       + `🍱 <b>Ăn uống:</b>\n`
                       + `- /menu: Bấm nút để chọn món ăn trưa\n`
                       + `- /ds: Xem danh sách tổng hợp ai đã đặt món gì\n`
                       + `- /huy: Xóa món ăn bạn vừa bấm chọn nhầm\n`
                       + `- /chotdon <ID> <Tiền>: (Admin) Chốt hóa đơn của 1 quán và chia đều mã giảm giá\n`
                       + `- /rc: Hiển thị danh sách nợ & Mã QR thanh toán.`;
        await bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'HTML' });
    } catch (e) {
        console.error(e);
    }
});

const app = express();
const cors = require('cors');

// --- LINE BOT CONFIG ---
const line = require('@line/bot-sdk');
const lineConfig = {
    channelAccessToken: process.env.LINE_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};
let lineClient = null;
if (lineConfig.channelAccessToken && lineConfig.channelSecret) {
    lineClient = new line.Client(lineConfig);
}
const LINE_GROUP_ID = process.env.LINE_GROUP_ID;

if (lineClient) {
    app.post('/api/line/webhook', line.middleware(lineConfig), async (req, res) => {
        Promise.all(req.body.events.map(require('./line_handler')(lineClient, menus, globalOrders, debts, saveOrders, saveDebts, footballEvent, saveFootball)))
            .then(() => res.status(200).end())
            .catch((err) => {
                console.error(err);
                res.status(500).end();
            });
    });
}

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

// API Nhận biến động số dư từ SePay
app.post('/api/sepay/webhook', async (req, res) => {
    try {
        // Bảo mật cơ bản (Tùy chọn)
        if (req.query.token !== 'sieubot123') {
            return res.status(403).json({ error: 'Unauthorized webhook token' });
        }
        
        const tx = req.body;
        // SePay thường truyền transferType là 'in' cho tiền vào
        if (tx && tx.transferType === 'in') {
            const amount = parseInt(tx.transferAmount);
            const content = (tx.content || '').toString();
            
            // Helper function to remove Vietnamese tones
            const removeVietnameseTones = (str) => {
                str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g,"a"); 
                str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g,"e"); 
                str = str.replace(/ì|í|ị|ỉ|ĩ/g,"i"); 
                str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g,"o"); 
                str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g,"u"); 
                str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g,"y"); 
                str = str.replace(/đ/g,"d");
                str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
                str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
                str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
                str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
                str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
                str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
                str = str.replace(/Đ/g, "D");
                return str;
            };

            // Xử lý nội dung chuyển khoản để khớp tên (loại bỏ khoảng trắng, ký tự đặc biệt, đưa về viết thường)
            const normalizedContent = removeVietnameseTones(content).replace(/[^a-z0-9]/gi, '').toLowerCase();
            
            let foundUser = null;
            for (const user of Object.keys(debts)) {
                if (debts[user] > 0) {
                    const normalizedUser = removeVietnameseTones(user).replace(/[^a-z0-9]/gi, '').toLowerCase();
                    if (normalizedUser && normalizedContent.includes(normalizedUser)) {
                        foundUser = user;
                        break;
                    }
                }
            }
            
            if (foundUser) {
                // Xóa nợ
                const debtAmount = debts[foundUser];
                debts[foundUser] = 0;
                saveDebts();
                
                // Gửi thông báo lên Telegram Group
                const successMsg = `🎉 <b>TINH TINH! ĐÃ NHẬN TIỀN</b>\n\n`
                          + `✅ Hệ thống tự động xác nhận đã nhận được <b>${amount.toLocaleString()}đ</b> qua MB Bank!\n`
                          + `🆔 Khớp với nội dung: <i>"${content}"</i>\n`
                          + `😎 Gạch nợ thành công cho: <b>@${foundUser}</b> (Nợ cũ: ${debtAmount.toLocaleString()}đ)`;
                          
                await bot.sendMessage(TELEGRAM_CHAT_ID, successMsg, { parse_mode: 'HTML' });
                try {
                    if (lineClient && LINE_GROUP_ID) {
                        await lineClient.pushMessage(LINE_GROUP_ID, { type: 'text', text: successMsg.replace(/<[^>]*>?/gm, '') });
                    }
                } catch(e) { console.error('Lỗi gửi LINE:', e.message); }
                
                return res.json({ success: true, message: `Matched and cleared debt for ${foundUser}` });
            }
            
            return res.json({ success: true, message: 'Transfer received but no matching debtor found' });
        }
        
        res.json({ success: true, message: 'Ignored non-inward transfer' });
    } catch (e) {
        console.error('Lỗi API SePay:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Web server giả đang chạy trên port ${PORT}`);
    console.log('✅ Bot Telegram đã khởi động và đang online!');
});

// --- XỬ LÝ ĐIỂM DANH BÓNG ĐÁ ---
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'thanhngan654,ngân nguyễn,ngan nguyen,160817-ngân nguyễn').split(',').map(s => s.trim().toLowerCase());
function isAdmin(user) {
    return ADMIN_USERNAMES.includes(user.toLowerCase());
}

bot.onText(/\/diemdanh/, async (msg) => {
    const chatId = msg.chat.id;
    if (footballEvent.isLocked) {
        return bot.sendMessage(chatId, '⚠ Trận bóng đã chốt, không thể điểm danh thêm!');
    }
    footballEvent.isActive = true;
    saveFootball();

    const inlineKeyboard = [
        [{ text: '+1 người', callback_data: 'fb_add' }, { text: 'Cancel', callback_data: 'fb_cancel' }]
    ];

    try {
        await bot.sendPhoto(chatId, 'https://artlive.vn/wp-content/uploads/2024/03/image-116.png', {
            caption: '⚽ <b>ĐIỂM DANH ĐÁ BANH</b>\nAnh em bấm nút bên dưới để báo cáo quân số nhé!',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
    } catch(e) { console.error(e); }
});

bot.onText(/\/dsbanh/, (msg) => {
    const chatId = msg.chat.id;
    if (!footballEvent.isActive) return bot.sendMessage(chatId, 'Chưa có trận bóng nào đang mở.');
    
    let msgText = '⚽ <b>DANH SÁCH ĐIỂM DANH BÓNG ĐÁ:</b>\n\n';
    let totalSlots = 0;
    for (const [user, slots] of Object.entries(footballEvent.users)) {
        msgText += `- ${user}: ${slots} người\n`;
        totalSlots += slots;
    }
    
    if (totalSlots === 0) msgText += 'Chưa có ai điểm danh.\n';
    else {
        msgText += `\n=> Tổng cộng: ${totalSlots} người (Dự kiến ${(totalSlots * 40).toLocaleString()}k)`;
    }
    if (footballEvent.isLocked) msgText += '\n🔒 TRẬN ĐÃ CHỐT!';
    
    bot.sendMessage(chatId, msgText, { parse_mode: 'HTML' });
});

bot.onText(/\/huykeo/, (msg) => {
    const user = msg.from.username || msg.from.first_name || 'Khách';
    if (!isAdmin(user)) return bot.sendMessage(msg.chat.id, '❌ Bạn không có quyền Hủy kèo.');
    
    footballEvent = { isActive: false, isLocked: false, users: {} };
    saveFootball();
    bot.sendMessage(msg.chat.id, '🗑 Trận bóng đã bị hủy. Đã reset danh sách.');
});

bot.onText(/\/chotsan/, (msg) => {
    const user = msg.from.username || msg.from.first_name || 'Khách';
    if (!isAdmin(user)) return bot.sendMessage(msg.chat.id, '❌ Bạn không có quyền Chốt sân.');
    
    if (!footballEvent.isActive || footballEvent.isLocked) {
        return bot.sendMessage(msg.chat.id, 'Không có trận nào đang mở để chốt!');
    }
    
    footballEvent.isLocked = true;
    let totalSlots = 0;
    for (const [u, slots] of Object.entries(footballEvent.users)) {
        if (!debts[u]) debts[u] = 0;
        debts[u] += slots * 40000;
        totalSlots += slots;
    }
    
    saveFootball();
    saveDebts();
    
    bot.sendMessage(msg.chat.id, `✅ <b>ĐÃ CHỐT SÂN!</b>\nTổng cộng ${totalSlots} người đã được cộng công nợ (40k/người) vào sổ.\nSử dụng /tienno để xem tổng nợ.`, { parse_mode: 'HTML' });
});

bot.onText(/\/helpme/, (msg) => {
    const text = `📚 <b>DANH SÁCH CÚ PHÁP:</b>
/menu - Xem menu gọi món
/ds - Xem danh sách đặt món
/huy - Hủy món đã đặt
/diemdanh - Mở form điểm danh bóng đá
/dsbanh - Xem danh sách bóng đá
/tienno - Xem ai nợ bao nhiêu tiền
/thanhtoan - Lấy QR code thanh toán nợ
/huykeo (Admin) - Hủy trận bóng
/chotsan (Admin) - Chốt bóng đá và cộng nợ
/chotdon (Admin) - Chốt đơn cơm và cộng nợ
/xacnhan Tên SốTiền (Admin) - Trừ nợ thủ công`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

bot.onText(/\/tienno/, (msg) => {
    const chatId = msg.chat.id;
    let text = '💰 <b>DANH SÁCH CÔNG NỢ:</b>\n\n';
    let total = 0;
    let hasDebt = false;
    
    for (const user in debts) {
        if (debts[user] > 0) {
            text += `👩🏻 ${user}: ${debts[user].toLocaleString()}đ\n`;
            total += debts[user];
            hasDebt = true;
        }
    }
    
    if (!hasDebt) text = '🎉 Tuyệt vời! Hiện tại không có ai nợ tiền.';
    else text += `\n=> <b>TỔNG NỢ: ${total.toLocaleString()}đ</b>\n👉 Gõ /thanhtoan để lấy mã QR thanh toán.`;
    
    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
});

bot.onText(/\/thanhtoan/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.username || msg.from.first_name || 'Khách';
    const amount = debts[userName] || 0;
    
    if (amount <= 0) {
        return bot.sendMessage(chatId, `${userName} ơi, bạn không có nợ gì cả. Tuyệt vời! 🥳`);
    }
    
    // Tương tự lệnh /rc cũ
    const bankId = 'MB';
    const accountNo = '03709868';
    const accountName = 'NGUYEN THANH NGAN';
    const addInfo = encodeURIComponent(`${userName} thanh toan`);
    
    const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${amount}&addInfo=${addInfo}&accountName=${encodeURIComponent(accountName)}`;
    
    bot.sendPhoto(chatId, qrUrl, {
        caption: `💳 ${userName} đang nợ <b>${amount.toLocaleString()}đ</b>.\nQuét mã QR bên trên để thanh toán.\nNội dung CK: ${userName} thanh toan`,
        parse_mode: 'HTML'
    });
});

bot.onText(/\/xacnhan (.+) (\d+)/, (msg, match) => {
    const user = msg.from.username || msg.from.first_name || 'Khách';
    if (!isAdmin(user)) return bot.sendMessage(msg.chat.id, '❌ Chỉ Admin mới được dùng lệnh này.');
    
    const targetUser = match[1].trim();
    const amount = parseInt(match[2], 10);
    
    if (!debts[targetUser]) {
        return bot.sendMessage(msg.chat.id, `Không tìm thấy nợ của ${targetUser}.`);
    }
    
    debts[targetUser] = Math.max(0, debts[targetUser] - amount);
    saveDebts();
    
    bot.sendMessage(msg.chat.id, `✅ Đã trừ ${amount.toLocaleString()}đ cho ${targetUser}. Nợ còn lại: ${debts[targetUser].toLocaleString()}đ.`);
});
