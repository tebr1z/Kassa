type Translator = (key:string)=>string;

const roleLabels:Record<string,string>={
  admin:'Rəhbər',
  manager:'Menecer',
  warehouse:'Anbardar',
  accountant:'Mühasib',
  cashier:'Kassir',
  online_manager:'Onlayn sifariş meneceri',
  online_assistant:'Onlayn sifariş köməkçisi',
};

export function staffRoleLabel(role:string){return roleLabels[role]||'İşçi';}

// Only seeded administrator names are display labels. Real employee names must
// not be translated or rewritten, including names belonging to other roles.
export function staffDisplayName(fullName:string,role:string,translate:Translator=key=>key){
  const normalized=fullName.trim().toLowerCase();
  return role==='admin'&&['sistem administratoru','administrator','admin'].includes(normalized)
    ?translate('Baş rəhbər'):fullName;
}

// Navigation/permission keys stay stable; only the visible heading changes.
export function staffSectionLabel(key:string){return key==='İdarə paneli'?'İdarəetmə mərkəzi':key;}

export function canAssignStaffPassword(role:string){
  return ['admin','manager','warehouse','accountant','cashier','online_manager','online_assistant'].includes(role);
}
