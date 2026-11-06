import type {ReactNode} from 'react';
import {privateRobots} from '@/lib/seo';
export const metadata={title:'Müştəri paneli',robots:privateRobots};
export default function AccountLayout({children}:{children:ReactNode}){return children;}
