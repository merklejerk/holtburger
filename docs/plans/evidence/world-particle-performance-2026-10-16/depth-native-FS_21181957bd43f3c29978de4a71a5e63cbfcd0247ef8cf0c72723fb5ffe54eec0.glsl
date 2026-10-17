#version 300 es
struct _uPortalArrivalMetadata_0 {
  highp vec4 _uentryPlane;
  highp uvec4 _uroute;
};
struct _uPortalScopeMetadata_0 {
  highp uvec4 _uatlasAndScreenOrigin;
  highp uvec4 _uextentAndReserved;
};
uniform lowp sampler2D _uuBase;
layout(std140) uniform _bPortalScopeAtlasMetadata{
  layout(column_major) highp mat4 _uuClipFromAnchor;
  _uPortalArrivalMetadata_0 _uuArrivals[255];
  _uPortalScopeMetadata_0 _uuScopes[255];
};
uniform lowp sampler2D _uuPalette;
uniform highp float _uuAlphaTest;
uniform highp sampler2D _uuPortalEnvelopeDepth;
uniform highp uint _uuPortalRenderDomain;
uniform highp int _uuMaterialKind;
uniform highp vec4 _uuMaterialColor;
uniform highp int _uuPalettedClipMap;
uniform highp float _uuOpacityScale;
uniform highp int _uuCanvasEmissionMode;
in highp vec2 _uvReplayClipDepth;
in highp vec2 _uvTextureCoordinate;
in highp float _uvTranslucency;
out highp vec4 _uoutColor;
highp ivec2 _uportalScopeAtlasPixel(in _uPortalScopeMetadata_0 _uscope, in highp ivec2 _uscreenPixel){
  return ((ivec2(_uscope._uatlasAndScreenOrigin.xy) + _uscreenPixel) - ivec2(_uscope._uatlasAndScreenOrigin.zw));
}
highp float _uportalEnvelopeDepthAtAtlasPixel(in _uPortalScopeMetadata_0 _uscope, in highp ivec2 _uatlasPixel){
  highp float _uenvelopeDepth = texelFetch(_uuPortalEnvelopeDepth, _uatlasPixel, 0).x;
  highp ivec2 _uatlasMinimum = ivec2(_uscope._uatlasAndScreenOrigin.xy);
  const highp ivec2 sc0a = ivec2(1, 1);
  highp ivec2 _uatlasMaximum = ((_uatlasMinimum + ivec2(_uscope._uextentAndReserved.xy)) - sc0a);
  if ((_uenvelopeDepth == 0.0))
  {
    const highp int sc0b = 1;
    for (highp int _uy = -2; (_uy <= 2); (_uy += sc0b))
    {
      const highp int sc0c = 1;
      for (highp int _ux = -2; (_ux <= 2); (_ux += sc0c))
      {
        highp ivec2 _ucandidatePixel = clamp((_uatlasPixel + ivec2(_ux, _uy)), _uatlasMinimum, _uatlasMaximum);
        (_uenvelopeDepth = max(_uenvelopeDepth, texelFetch(_uuPortalEnvelopeDepth, _ucandidatePixel, 0).x));
      }
    }
  }
  return _uenvelopeDepth;
}
bool _uportalDeferredFragmentVisible(){
  const highp float sc0d = 0.0;
  const highp float sc0e = 254.0;
  _uPortalScopeMetadata_0 _uscope = _uuScopes[int(clamp(float(_uuPortalRenderDomain), sc0d, sc0e))];
  highp ivec2 _uscreenPixel = ivec2(gl_FragCoord.xy);
  highp ivec2 _urelativePixel = (_uscreenPixel - ivec2(_uscope._uatlasAndScreenOrigin.zw));
  highp ivec2 _uscopeExtent = ivec2(_uscope._uextentAndReserved.xy);
  if ((any(lessThan(_urelativePixel, ivec2(0, 0))) || any(greaterThanEqual(_urelativePixel, _uscopeExtent))))
  {
    return false;
  }
  highp ivec2 _uatlasPixel = _uportalScopeAtlasPixel(_uscope, _uscreenPixel);
  highp float _uenvelopeDepth = _uportalEnvelopeDepthAtAtlasPixel(_uscope, _uatlasPixel);
  const highp float sc0f = 0.5;
  return ((_uenvelopeDepth == 1.0) || ((gl_FragCoord.z * sc0f) < _uenvelopeDepth));
}
bool _ureplayAlternativePortalVisible(){
  const highp float sc10 = 0.0;
  const highp float sc11 = 254.0;
  _uPortalScopeMetadata_0 _uscope = _uuScopes[int(clamp(float(_uuPortalRenderDomain), sc10, sc11))];
  highp ivec2 _uscreenPixel = ivec2(gl_FragCoord.xy);
  highp ivec2 _urelativePixel = (_uscreenPixel - ivec2(_uscope._uatlasAndScreenOrigin.zw));
  highp ivec2 _uscopeExtent = ivec2(_uscope._uextentAndReserved.xy);
  if ((any(lessThan(_urelativePixel, ivec2(0, 0))) || any(greaterThanEqual(_urelativePixel, _uscopeExtent))))
  {
    return false;
  }
  highp ivec2 _uatlasPixel = _uportalScopeAtlasPixel(_uscope, _uscreenPixel);
  highp float _uenvelopeDepth = _uportalEnvelopeDepthAtAtlasPixel(_uscope, _uatlasPixel);
  const highp float sc12 = 0.5;
  const highp float sc13 = 0.5;
  const highp float sc14 = 0.5;
  return ((_uenvelopeDepth == 1.0) || (((((_uvReplayClipDepth.x / _uvReplayClipDepth.y) * sc12) + sc13) * sc14) < _uenvelopeDepth));
}
void main(){
  (_uoutColor = vec4(0.0, 0.0, 0.0, 0.0));
  const highp float sc15 = 0.5;
  highp float _uexpectedDepth = (gl_FragCoord.z * sc15);
  const highp float sc16 = 0.5;
  const highp float sc17 = 0.5;
  const highp float sc18 = 0.5;
  highp float _ureconstructedDepth = ((((_uvReplayClipDepth.x / _uvReplayClipDepth.y) * sc16) + sc17) * sc18);
  highp float _udifference = (_ureconstructedDepth - _uexpectedDepth);
  bool _uexpected = _uportalDeferredFragmentVisible();
  bool _uactual = _ureplayAlternativePortalVisible();
  (_uoutColor = vec4(abs(_udifference), max(_udifference, 0.0), max((-_udifference), 0.0), float((_uexpected != _uactual))));
}
