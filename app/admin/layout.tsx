import type {ReactNode} from 'react';
import {privateRobots} from '@/lib/seo';
export const metadata={title:'İdarəetmə',robots:privateRobots};
export default function AdminLayout({children}:{children:ReactNode}){return children;}
