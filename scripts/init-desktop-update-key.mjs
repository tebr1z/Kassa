import {generateKeyPairSync,createPrivateKey,createPublicKey} from 'node:crypto';
import {mkdir,lstat,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function noSymbolicLinks(target,{missing=false}={}) {
 const absolute=path.resolve(target),parsed=path.parse(absolute);let current=parsed.root;
 for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
  current=path.join(current,part);
  try{if((await lstat(current)).isSymbolicLink())throw Error('A release path must not contain a symbolic link or junction.');}
  catch(error){if(missing&&error.code==='ENOENT')return;throw error;}
 }
}

// The only variable passed to PowerShell is a path, never private key bytes.
const aclScript=`$ErrorActionPreference='Stop';
$target=$env:RM_RELEASE_KEY_ACL_TARGET;
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;
$system=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18');
$item=Get-Item -LiteralPath $target -Force;
if($item.PSIsContainer){$acl=New-Object System.Security.AccessControl.DirectorySecurity;$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{$acl=New-Object System.Security.AccessControl.FileSecurity;$inherit=[System.Security.AccessControl.InheritanceFlags]::None};
$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);
foreach($principal in @($sid,$system)){$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($principal,'FullControl',$inherit,'None','Allow');$acl.AddAccessRule($rule)};
Set-Acl -LiteralPath $target -AclObject $acl;`;

export async function restrictKeyPath(target) {
 await noSymbolicLinks(target);
 if(process.platform!=='win32')throw Error('This key initializer requires Windows ACL support.');
 execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command',aclScript],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RM_RELEASE_KEY_ACL_TARGET:path.resolve(target)}});
}

export async function assertPrivatePathRestricted(target,{directory=false}={}) {
 await noSymbolicLinks(target);
 const item=await lstat(target);
 if(directory?!item.isDirectory():!item.isFile())throw Error('Signing key path has an unexpected file type.');
 if(process.platform==='win32') {
  const script=`$ErrorActionPreference='Stop';$acl=Get-Acl -LiteralPath $env:RM_RELEASE_KEY_ACL_TARGET;$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$allowed=@($sid,'S-1-5-18');if(-not $acl.AreAccessRulesProtected){throw 'Signing key ACL inheritance is enabled'};foreach($rule in $acl.Access){$id=$rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;if($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $id){throw 'Signing key grants access to another account'}};if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid){throw 'Signing key is not owned by the current user'}`;
  execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RM_RELEASE_KEY_ACL_TARGET:path.resolve(target)}});
 } else if((item.mode&0o077)!==0||typeof process.getuid!=='function'||item.uid!==process.getuid())throw Error('Signing key must be owned by this user and have no group/other access.');
}
export async function assertPrivateKeyRestricted(target){return assertPrivatePathRestricted(target);}

export function publicKeyPem(privateBytes) {
 const key=createPrivateKey(privateBytes);if(key.asymmetricKeyType!=='ed25519')throw Error('The signing key must be Ed25519.');
 return createPublicKey(key).export({type:'spki',format:'pem'}).toString();
}

export async function initializeKey({directory,protect=restrictKeyPath,check=assertPrivatePathRestricted}) {
 await noSymbolicLinks(directory,{missing:true});await mkdir(directory,{recursive:true,mode:0o700});
 try{await check(directory,{directory:true});}catch{await protect(directory);await check(directory,{directory:true});}
 const target=path.join(directory,'desktop-update-ed25519-v1.key');await noSymbolicLinks(target,{missing:true});
 let existed=false;
 try{await lstat(target);existed=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!existed) {
  const {privateKey}=generateKeyPairSync('ed25519');
  await writeFile(target,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
  await protect(target);
 }
 // Already protected keys are read-only on subsequent invocations. An
 // existing key with unsafe permissions needs review, not a silent repair.
 await check(target);
 return {target,created:!existed,publicKey:publicKeyPem(await readFile(target))};
}

async function main() {
 if(process.argv.length!==2)throw Error('Usage: node scripts/init-desktop-update-key.mjs');
 if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('Initialize on the Windows release computer, not on the public server.');
 const directory=path.resolve(process.env.LOCALAPPDATA,'RestaMarketReleaseKeys');
 const result=await initializeKey({directory});await assertPrivateKeyRestricted(result.target);
 console.log(`${result.created?'Created':'Existing key retained'}: ${result.target}`);
 console.log('PUBLIC KEY ONLY — pin this in desktop/update-trust.json:');console.log(result.publicKey.trim());
 console.log('Back up the private key separately and offline. Never upload it or add it to the repository.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error('Key initialization failed: '+error.message);process.exitCode=1;});
