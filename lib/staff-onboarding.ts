export function staffPasswordFormError(password:string,confirmation:string){
 if(password.length<12||password.length>128||!/[\p{L}]/u.test(password)||!/[0-9]/.test(password))return 'Ən azı 12 simvol, hərf və rəqəm istifadə edin.';
 if(password!==confirmation)return 'Şifrələr eyni deyil.';
 return '';
}
