/**
 * Nexrelm admin CLI — invoked through the `/usr/local/bin/nexrelm` wrapper that
 * the installer generates. It talks to ~/.nexrelm/auth.json directly (no HTTP),
 * so it works whether or not the control plane is running, and the running
 * service picks up changes immediately because it reads the file fresh on every
 * request. Commands: setup · reset-password · status · help.
 */
import { accountInfo, isAuthInitialized, resetPassword, setupAuth } from './core/auth';

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

function credentialBox(username: string, password: string): void {
  const line = '─'.repeat(52);
  console.log('');
  console.log(C.cyan(`  ┌${line}┐`));
  console.log(C.cyan('  │ ') + C.bold('Nexrelm admin credentials') + C.dim('  (store these safely)').padEnd(28) + C.cyan('│'));
  console.log(C.cyan(`  ├${line}┤`));
  console.log(C.cyan('  │  ') + 'Username:  ' + C.bold(username));
  console.log(C.cyan('  │  ') + 'Password:  ' + C.bold(C.yellow(password)));
  console.log(C.cyan(`  └${line}┘`));
  console.log('');
}

function usage(): void {
  console.log(`
${C.bold('nexrelm')} — Nexrelm admin CLI

  ${C.cyan('nexrelm setup')}                     Create the admin account (first install only).
  ${C.cyan('nexrelm reset-password')}            Generate a new temp password (forces a change at next sign-in).
  ${C.cyan('nexrelm reset-password --password')} ${C.dim('<pw>')}  Set a specific password (used as-is, min 8 chars).
  ${C.cyan('nexrelm status')}                    Show account state (initialized, sessions, last change).
  ${C.cyan('nexrelm help')}                      This help.

  Run with ${C.bold('sudo')} if you are not the service user. Data: ${C.dim('~/.nexrelm/auth.json')}
`);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'setup': {
      if (isAuthInitialized()) {
        console.error(C.yellow('Nexrelm is already set up.') + ' Change the password in the app (Settings → Account), or run ' + C.cyan('nexrelm reset-password') + '.');
        process.exit(3);
      }
      const r = setupAuth();
      console.log(C.green('✓ admin account created.'));
      credentialBox(r.username, r.password);
      console.log('  Next: open Nexrelm, sign in with these credentials, then set your own password when prompted.');
      console.log('');
      break;
    }
    case 'reset-password':
    case 'resetpassword': {
      const i = rest.indexOf('--password');
      const pw = i >= 0 ? rest[i + 1] : undefined;
      const r = resetPassword(pw);
      console.log(C.green('✓ password reset — all existing sessions were signed out.'));
      credentialBox(r.username, r.password);
      console.log(pw ? '  Sign in with this password.' : '  This is a temporary password — you will be asked to set a new one at next sign-in.');
      console.log('');
      break;
    }
    case 'status': {
      console.log(JSON.stringify(accountInfo(), null, 2));
      break;
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined: {
      usage();
      break;
    }
    default: {
      console.error(C.red(`unknown command: ${cmd}`));
      usage();
      process.exit(2);
    }
  }
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error(C.red('nexrelm: ') + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}
