import Image from 'next/image';
export function BrandLogo({size=40,className=""}:{size?:number;className?:string}){
 return <Image className={className} src="/restamarket-mark.svg" alt="" width={size} height={size} unoptimized/>;
}
