const { Pool } = require('pg');
require('dotenv').config();

let dbUrl = process.env.DATABASE_URL || '';
if (dbUrl.includes('channel_binding=require')) {
    dbUrl = dbUrl.replace('&channel_binding=require', '').replace('?channel_binding=require', '');
}

const pool = new Pool({
    connectionString: dbUrl,
    ssl: (dbUrl.includes('render.com') || dbUrl.includes('neon.tech') || dbUrl.includes('sslmode=require')) ? { rejectUnauthorized: false } : false
});

async function initDB() {
    if (!process.env.DATABASE_URL) {
        console.warn('⚠ Chưa có DATABASE_URL. Bỏ qua khởi tạo DB.');
        return;
    }
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key VARCHAR(50) PRIMARY KEY,
                value JSONB NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS debts (
                username VARCHAR(255) PRIMARY KEY,
                amount INTEGER NOT NULL DEFAULT 0
            );
            
            CREATE TABLE IF NOT EXISTS football_state (
                id INTEGER PRIMARY KEY DEFAULT 1,
                is_active BOOLEAN NOT NULL DEFAULT false,
                is_locked BOOLEAN NOT NULL DEFAULT false
            );
            
            CREATE TABLE IF NOT EXISTS football_attendance (
                username VARCHAR(255) PRIMARY KEY,
                slots INTEGER NOT NULL DEFAULT 1
            );
        `);
        
        // Init football state row if not exists
        await client.query(`
            INSERT INTO football_state (id, is_active, is_locked) 
            VALUES (1, false, false) 
            ON CONFLICT (id) DO NOTHING;
        `);
        console.log('✅ Đã khởi tạo Database PostgreSQL thành công!');
    } catch (err) {
        console.error('❌ Lỗi khởi tạo Database:', err);
    } finally {
        client.release();
    }
}

async function getKV(key, defaultValue) {
    if (!process.env.DATABASE_URL) return defaultValue;
    try {
        const res = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
        if (res.rows.length > 0) return res.rows[0].value;
        return defaultValue;
    } catch (e) {
        console.error(e);
        return defaultValue;
    }
}

async function setKV(key, value) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(
            'INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [key, JSON.stringify(value)]
        );
    } catch (e) {
        console.error(e);
    }
}

async function getDebts() {
    if (!process.env.DATABASE_URL) return {};
    try {
        const res = await pool.query('SELECT * FROM debts');
        const debts = {};
        for (const row of res.rows) {
            debts[row.username] = row.amount;
        }
        return debts;
    } catch (e) {
        console.error(e);
        return {};
    }
}

async function saveDebts(debts) {
    if (!process.env.DATABASE_URL) return;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM debts'); // Clear old debts, or we can just update
        for (const [user, amount] of Object.entries(debts)) {
            if (amount > 0) {
                await client.query('INSERT INTO debts (username, amount) VALUES ($1, $2)', [user, amount]);
            }
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
    } finally {
        client.release();
    }
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    initDB,
    getKV,
    setKV,
    getDebts,
    saveDebts
};
