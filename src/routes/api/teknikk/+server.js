import { json } from '@sveltejs/kit';
import { JWT_SECRET, POSTGRES_URL } from '$env/static/private';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';



function getDb() {
    return neon(POSTGRES_URL); 
}

function getUserHash(cookies) {
    const token = cookies.get('auth_token');
    if (!token) throw new Error('Ikke innlogget');
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.userKeyHash;
}

export async function GET({ cookies }) {
    try {
        const token = cookies.get('auth_token');
        if (!token) throw new Error('Ikke innlogget');
        const decoded = jwt.verify(token, JWT_SECRET);

        let targetHash;
        if (decoded.isAdmin) {
            // Admin: bruk lagret hash fra cookie, ikke noe fra frontend
            targetHash = cookies.get('last_search_hash');
            if (!targetHash) return json([]);
        } else {
            targetHash = decoded.userKeyHash;
        }

        const sql = getDb();
        const logger = await sql`
            SELECT id, dato::text, stilart, tilbakemelding, 
                COALESCE(video_urls, '{}') AS video_urls,
                created_at
            FROM teknikk_logger
            WHERE user_key_hash = ${targetHash}
            ORDER BY dato DESC, created_at DESC
        `;
        return json(logger);
    } catch {
        return json({ error: 'Ikke tilgang' }, { status: 401 });
    }
}

export async function POST({ request, cookies }) {
    try {
        const userKeyHash = getUserHash(cookies);
        const { dato, stilart, tilbakemelding, video_urls } = await request.json();

        if (!dato || !stilart) return json({ error: 'Dato og stilart er påkrevd' }, { status: 400 });

        const sql = getDb();
        const [row] = await sql`
            INSERT INTO teknikk_logger (user_key_hash, dato, stilart, tilbakemelding, video_urls)
            VALUES (${userKeyHash}, ${dato}, ${stilart}, ${tilbakemelding || ''}, ${video_urls || []})
            RETURNING id
        `;
        return json({ success: true, id: row.id });

    } catch (error) {
        // Logg hele feilen på serveren
        console.error('POST teknikk feil:', error);
        // Send faktisk feilmelding tilbake til klienten
        return json({ 
            error: error?.message ?? String(error),
            detail: error?.detail ?? null,        // Postgres-spesifikk info
            code: error?.code ?? null             // Postgres feilkode
        }, { status: 500 });
    }
}

export async function PUT({ request, cookies }) {
    try {
        const userKeyHash = getUserHash(cookies);
        const { id, dato, stilart, tilbakemelding, video_urls } = await request.json();

        const sql = getDb();
        await sql`
            UPDATE teknikk_logger
            SET dato = ${dato}, stilart = ${stilart}, 
                tilbakemelding = ${tilbakemelding || ''},
                video_urls = ${video_urls || []}
            WHERE id = ${id} AND user_key_hash = ${userKeyHash}
        `;
        return json({ success: true });
        }   catch (error) {
                console.error('Rediger feil:', error);
                teknikkFeil = error instanceof Error ? error.message : String(error);
    }
}

export async function DELETE({ request, cookies }) {
    try {
        const userKeyHash = getUserHash(cookies);
        const { id } = await request.json();
        const sql = getDb();
        // user_key_hash-sjekk sikrer at man kun kan slette egne rader
        await sql`
            DELETE FROM teknikk_logger
            WHERE id = ${id} AND user_key_hash = ${userKeyHash}
        `;
        return json({ success: true });
    } catch {
        return json({ error: 'Kunne ikke slette' }, { status: 500 });
    }
}
