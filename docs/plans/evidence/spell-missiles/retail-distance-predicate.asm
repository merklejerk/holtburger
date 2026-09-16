
/home/cluracan/code/ac-re/ac-bins/acclient.exe:     file format pei-i386


Disassembly of section .text:

00517f50 <.text+0x116f50>:
  517f50:	8b 41 60             	mov    eax,DWORD PTR [ecx+0x60]
  517f53:	85 c0                	test   eax,eax
  517f55:	7e 06                	jle    0x517f5d
  517f57:	39 44 24 08          	cmp    DWORD PTR [esp+0x8],eax
  517f5b:	7d 64                	jge    0x517fc1
  517f5d:	8b 44 24 04          	mov    eax,DWORD PTR [esp+0x4]
  517f61:	3b 41 58             	cmp    eax,DWORD PTR [ecx+0x58]
  517f64:	7d 5b                	jge    0x517fc1
  517f66:	8b 41 38             	mov    eax,DWORD PTR [ecx+0x38]
  517f69:	a8 01                	test   al,0x1
  517f6b:	74 1c                	je     0x517f89
  517f6d:	dd 05 a8 79 83 00    	fld    QWORD PTR ds:0x8379a8
  517f73:	dc 64 24 10          	fsub   QWORD PTR [esp+0x10]
  517f77:	dc 59 50             	fcomp  QWORD PTR [ecx+0x50]
  517f7a:	df e0                	fnstsw ax
  517f7c:	f6 c4 41             	test   ah,0x41
  517f7f:	75 40                	jne    0x517fc1
  517f81:	b8 01 00 00 00       	mov    eax,0x1
  517f86:	c2 14 00             	ret    0x14
  517f89:	a8 02                	test   al,0x2
  517f8b:	74 34                	je     0x517fc1
  517f8d:	8b 44 24 0c          	mov    eax,DWORD PTR [esp+0xc]
  517f91:	d9 40 08             	fld    DWORD PTR [eax+0x8]
  517f94:	d9 40 04             	fld    DWORD PTR [eax+0x4]
  517f97:	d9 00                	fld    DWORD PTR [eax]
  517f99:	dd 41 50             	fld    QWORD PTR [ecx+0x50]
  517f9c:	d9 c1                	fld    st(1)
  517f9e:	d8 ca                	fmul   st,st(2)
  517fa0:	d9 c3                	fld    st(3)
  517fa2:	d8 cc                	fmul   st,st(4)
  517fa4:	de c1                	faddp  st(1),st
  517fa6:	d9 c4                	fld    st(4)
  517fa8:	d8 cd                	fmul   st,st(5)
  517faa:	de c1                	faddp  st(1),st
  517fac:	d9 c1                	fld    st(1)
  517fae:	d8 ca                	fmul   st,st(2)
  517fb0:	de d9                	fcompp
  517fb2:	dd d8                	fstp   st(0)
  517fb4:	dd d8                	fstp   st(0)
  517fb6:	df e0                	fnstsw ax
  517fb8:	dd d8                	fstp   st(0)
  517fba:	f6 c4 05             	test   ah,0x5
  517fbd:	dd d8                	fstp   st(0)
  517fbf:	7b c0                	jnp    0x517f81
  517fc1:	33 c0                	xor    eax,eax
  517fc3:	c2 14 00             	ret    0x14
