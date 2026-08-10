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

            CREATE TABLE IF NOT EXISTS football_matches (
                id SERIAL PRIMARY KEY,
                status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS football_match_details (
                id SERIAL PRIMARY KEY,
                match_id INTEGER NOT NULL REFERENCES football_matches(id) ON DELETE CASCADE,
                username VARCHAR(255) NOT NULL,
                slots INTEGER NOT NULL DEFAULT 1,
                UNIQUE(match_id, username)
            );
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
        await client.query('DELETE FROM debts');
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

// ---- Football Match Functions ----

async function getActiveMatch() {
    if (!process.env.DATABASE_URL) return null;
    try {
        const res = await pool.query("SELECT * FROM football_matches WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1");
        return res.rows.length > 0 ? res.rows[0] : null;
    } catch (e) {
        console.error(e);
        return null;
    }
}

async function getMatchById(matchId) {
    if (!process.env.DATABASE_URL) return null;
    try {
        const res = await pool.query('SELECT * FROM football_matches WHERE id = $1', [matchId]);
        return res.rows.length > 0 ? res.rows[0] : null;
    } catch (e) {
        console.error(e);
        return null;
    }
}

async function createMatch() {
    if (!process.env.DATABASE_URL) return null;
    try {
        const res = await pool.query("INSERT INTO football_matches (status) VALUES ('OPEN') RETURNING *");
        return res.rows[0];
    } catch (e) {
        console.error(e);
        return null;
    }
}

async function updateMatchStatus(matchId, status) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query('UPDATE football_matches SET status = $1 WHERE id = $2', [status, matchId]);
    } catch (e) {
        console.error(e);
    }
}

async function getMatchUsers(matchId) {
    if (!process.env.DATABASE_URL) return [];
    try {
        const res = await pool.query('SELECT * FROM football_match_details WHERE match_id = $1 ORDER BY id ASC', [matchId]);
        return res.rows;
    } catch (e) {
        console.error(e);
        return [];
    }
}

async function addMatchUser(matchId, username, slots) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(
            'INSERT INTO football_match_details (match_id, username, slots) VALUES ($1, $2, $3) ON CONFLICT (match_id, username) DO UPDATE SET slots = football_match_details.slots + $3',
            [matchId, username, slots]
        );
    } catch (e) {
        console.error(e);
    }
}

async function removeMatchUser(matchId, username) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query('DELETE FROM football_match_details WHERE match_id = $1 AND username = $2', [matchId, username]);
    } catch (e) {
        console.error(e);
    }
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    initDB,
    getKV,
    setKV,
    getDebts,
    saveDebts,
    getActiveMatch,
    getMatchById,
    createMatch,
    updateMatchStatus,
    getMatchUsers,
    addMatchUser,
    removeMatchUser
};
