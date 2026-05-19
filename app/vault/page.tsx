"use client";

import dynamic from 'next/dynamic';

const VaultPage = dynamic(() => import('@/components/vault/VaultPage'), {
  ssr: false,
  loading: () => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100dvh',gap:'0.75rem',color:'rgba(240,237,232,0.4)',fontSize:'0.85rem'}}>
      <span style={{
        width:18,height:18,
        border:'2px solid rgba(255,255,255,0.1)',
        borderTopColor:'rgba(180,80,40,0.8)',
        borderRadius:'50%',
        display:'inline-block',
      }} />
      Loading vault…
    </div>
  ),
});

export default function VaultRoute() {
  return <VaultPage />;
}
