import 'dotenv/config';
import { parseArgs } from 'node:util';
import pool from '../src/db/postgres.js';
import {
    createUserAccount,
    resetUserPassword
} from '../src/services/auth-service.js';

const usage = `
Create or update a Pelosi admin user.

Usage:
  npm run create-admin-user -- --email admin@example.com
  npm run create-admin-user -- --email admin@example.com --update-password

Options:
  --email, -e             User email address (required, stored lowercase)
  --password, -p          Password (or set ADMIN_USER_PASSWORD instead)
  --role, -r              Role, defaults to "admin"
  --update-password       Reset the password of an existing user
  --help, -h              Show this message

The password is never stored in plain text and never printed. Prefer the
ADMIN_USER_PASSWORD environment variable over --password so it does not end up
in your shell history.
`.trim();

const { values } = parseArgs({
    options: {
        email: { type: 'string', short: 'e' },
        password: { type: 'string', short: 'p' },
        role: { type: 'string', short: 'r' },
        'update-password': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
});

if (values.help) {
    console.log(usage);
    process.exit(0);
}

const email = values.email ?? process.env.ADMIN_USER_EMAIL;
const password = values.password ?? process.env.ADMIN_USER_PASSWORD;
const role = values.role ?? process.env.ADMIN_USER_ROLE ?? 'admin';

if (!email) {
    console.error('--email is required\n');
    console.error(usage);
    process.exit(1);
}

if (!password) {
    console.error('--password or ADMIN_USER_PASSWORD is required\n');
    console.error(usage);
    process.exit(1);
}

try {
    const user = values['update-password']
        ? await resetUserPassword({ email, password })
        : await createUserAccount({ email, password, role });

    console.log(
        values['update-password']
            ? `Password updated for user ${user.email} (id ${user.id}, role ${user.role})`
            : `Created user ${user.email} (id ${user.id}, role ${user.role})`
    );
} catch (error) {
    console.error(`Failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
