import { json } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { 
    JWT_SECRET, 
    USER_CREDENTIALS, 
    ADMIN_USERNAME_HASH, 
    ADMIN_PASSWORD_HASH 
} from '$env/static/private';

function sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

// Last brukerdata fra miljøvariabel
const USER_CREDS = JSON.parse(USER_CREDENTIALS || '{}');

const ADMIN_USER = {
    usernameHash: ADMIN_USERNAME_HASH,
    passwordHash: ADMIN_PASSWORD_HASH,
};

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
}

export async function POST({ request, cookies }) {
    try {
        const { username, password } = await request.json();
        const userKeyHash = sha256(username.toLowerCase());
        const hashedPassword = sha256(password);
        
        // Sjekk om det er admin
        if (userKeyHash === ADMIN_USER.usernameHash) {
            if (hashedPassword === ADMIN_USER.passwordHash) {
                const token = jwt.sign(
                    { 
                        userKeyHash,
                        username,
                        isAdmin: true 
                    },
                    JWT_SECRET,
                    { expiresIn: '365d' }
                );
                
                cookies.set('auth_token', token, {
                    path: '/',
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 60 * 60 * 24 * 365
                });
                
                return json({ 
                    success: true, 
                    isAdmin: true,
                    username 
                });
            } else {
                return json({ 
                    success: false, 
                    error: "Feil passord." 
                }, { status: 401 });
            }
        }
        
        // Vanlig bruker
        const user = USER_CREDS[userKeyHash];
        
        if (!user) {
            return json({ 
                success: false, 
                error: "Ugyldig brukernavn." 
            }, { status: 401 });
        }
        
        if (hashedPassword === user.hash) {
            const token = jwt.sign(
                { 
                    userKeyHash,
                    username,
                    isAdmin: false,
                    sheetUrl: user.sheetUrl,
                    editPlanSheet: user.editPlanSheet
                },
                JWT_SECRET,
                { expiresIn: '365d' }
            );
            
            cookies.set('auth_token', token, {
                path: '/',
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 60 * 60 * 24 * 365
            });
            
            return json({ 
                success: true, 
                isAdmin: false,
                sheetUrl: user.sheetUrl,
                editPlanSheet: user.editPlanSheet,
                username
            });
        } else {
            return json({ 
                success: false, 
                error: "Feil passord." 
            }, { status: 401 });
        }
        
    } catch (error) {
        console.error('Login error:', error);
        return json({ 
            success: false, 
            error: "Noe gikk galt." 
        }, { status: 500 });
    }
}
