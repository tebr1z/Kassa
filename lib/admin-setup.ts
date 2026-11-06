import 'server-only';

export async function adminSetupToken(){
 // The web launcher loads a private local key at runtime, never during Next's
 // file tracing. Deployments supply their own secret through the environment.
 return process.env.BIRKASSA_ADMIN_SETUP_TOKEN||'';
}
