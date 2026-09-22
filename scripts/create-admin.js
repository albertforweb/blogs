import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { db } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const exitWithUsage = () => {
    console.log('Usage: npm run create-admin -- --username admin --password secret --email admin@example.com');
    process.exit(1);
  };

  let username = args.username || await question('Username: ');
  let password = args.password || await question('Password (min 6 chars): ');
  if (args.password) password = args.password;
  let email = args.email || await question('Email (optional): ') || null;

  if (!username || !password || password.length < 6) exitWithUsage();

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    console.log(`User "${username}" already exists.`);
    process.exit(0);
  }

  const hash = await hashPassword(password);
  db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
    username, email, hash, 'admin'
  );
  console.log(`\nCreated admin user "${username}".`);
  console.log('You can now log in at:  http://localhost:4000/admin/');
}

async function question(prompt) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer.trim();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});