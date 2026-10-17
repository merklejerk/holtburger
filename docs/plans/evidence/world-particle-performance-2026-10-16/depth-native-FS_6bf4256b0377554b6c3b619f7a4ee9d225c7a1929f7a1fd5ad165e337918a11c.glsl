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
  const highp ivec2 sbff = ivec2(1, 1);
  highp ivec2 _uatlasMaximum = ((_uatlasMinimum + ivec2(_uscope._uextentAndReserved.xy)) - sbff);
  if ((_uenvelopeDepth == 0.0))
  {
    const highp int sc00 = 1;
    for (highp int _uy = -2; (_uy <= 2); (_uy += sc00))
    {
      const highp int sc01 = 1;
      for (highp int _ux = -2; (_ux <= 2); (_ux += sc01))
      {
        highp ivec2 _ucandidatePixel = clamp((_uatlasPixel + ivec2(_ux, _uy)), _uatlasMinimum, _uatlasMaximum);
        (_uenvelopeDepth = max(_uenvelopeDepth, texelFetch(_uuPortalEnvelopeDepth, _ucandidatePixel, 0).x));
      }
    }
  }
  return _uenvelopeDepth;
}
bool _uportalDeferredFragmentVisible(){
  const highp float sc02 = 0.0;
  const highp float sc03 = 254.0;
  _uPortalScopeMetadata_0 _uscope = _uuScopes[int(clamp(float(_uuPortalRenderDomain), sc02, sc03))];
  highp ivec2 _uscreenPixel = ivec2(gl_FragCoord.xy);
  highp ivec2 _urelativePixel = (_uscreenPixel - ivec2(_uscope._uatlasAndScreenOrigin.zw));
  highp ivec2 _uscopeExtent = ivec2(_uscope._uextentAndReserved.xy);
  if ((any(lessThan(_urelativePixel, ivec2(0, 0))) || any(greaterThanEqual(_urelativePixel, _uscopeExtent))))
  {
    return false;
  }
  highp ivec2 _uatlasPixel = _uportalScopeAtlasPixel(_uscope, _uscreenPixel);
  highp float _uenvelopeDepth = _uportalEnvelopeDepthAtAtlasPixel(_uscope, _uatlasPixel);
  const highp float sc04 = 0.5;
  const highp float sc05 = 0.5;
  const highp float sc06 = 0.5;
  return ((_uenvelopeDepth == 1.0) || (((((_uvReplayClipDepth.x / _uvReplayClipDepth.y) * sc04) + sc05) * sc06) < _uenvelopeDepth));
}
highp vec4 _uencodeTransparentCanvasEmission(in highp vec4 _ucolor, in highp int _umode){
  if ((_umode == 0))
  {
    return _ucolor;
  }
  const highp float sc07 = 1.0;
  const highp float sc08 = 1.0;
  highp float _usourceFactor = (((_umode == 1)) ? (sc07) : ((((_umode == 2)) ? (_ucolor.w) : ((sc08 - _ucolor.w)))));
  highp vec3 _uemission = max((_ucolor.xyz * _usourceFactor), vec3(0.0, 0.0, 0.0));
  highp float _ucoverage = clamp(max(_uemission.x, max(_uemission.y, _uemission.z)), 0.0, 1.0);
  const highp vec4 sc09 = vec4(0.0, 0.0, 0.0, 0.0);
  return (((_ucoverage > 0.0)) ? (vec4((_uemission / _ucoverage), _ucoverage)) : (sc09));
}
highp float _upaletteIndexAt(in highp ivec2 _utexel){
  highp ivec2 _usize = textureSize(_uuBase, 0);
  const highp ivec2 sc0a = ivec2(1, 1);
  (_utexel = clamp(_utexel, ivec2(0, 0), (_usize - sc0a)));
  highp vec4 _uencoded = (texelFetch(_uuBase, _utexel, 0) * 255.0);
  const highp float sc0b = 0.5;
  const highp float sc0c = 0.5;
  const highp float sc0d = 256.0;
  const highp float sc0e = 0.5;
  return (((_uuMaterialKind == 3)) ? ((floor((_uencoded.x + sc0b)) + (floor((_uencoded.y + sc0c)) * sc0d))) : (floor((_uencoded.x + sc0e))));
}
highp vec4 _upaletteColor(in highp float _uindex){
  if (((_uuPalettedClipMap != 0) && (_uindex < 8.0)))
  {
    return vec4(0.0, 0.0, 0.0, 0.0);
  }
  highp ivec2 _usize = textureSize(_uuPalette, 0);
  if ((_uindex >= float((_usize.x * _usize.y))))
  {
    return vec4(0.0, 0.0, 0.0, 0.0);
  }
  return texelFetch(_uuPalette, ivec2(int(mod(_uindex, float(_usize.x))), (int(_uindex) / _usize.x)), 0);
}
highp vec4 _uindexedColorAt(in highp ivec2 _utexel){
  return _upaletteColor(_upaletteIndexAt(_utexel));
}
highp vec4 _usampleIndexedPaletteLinear(in highp vec2 _uuv){
  highp ivec2 _usourceSize = textureSize(_uuBase, 0);
  const highp vec2 sc0f = vec2(0.5, 0.5);
  highp vec2 _utexelPosition = ((_uuv * vec2(_usourceSize)) - sc0f);
  highp ivec2 _ubaseCoordinate = ivec2(floor(_utexelPosition));
  highp vec2 _ublend = fract(_utexelPosition);
  const highp ivec2 sc10 = ivec2(1, 0);
  highp vec4 _utop = mix(_uindexedColorAt(_ubaseCoordinate), _uindexedColorAt((_ubaseCoordinate + sc10)), _ublend.x);
  const highp ivec2 sc11 = ivec2(0, 1);
  const highp ivec2 sc12 = ivec2(1, 1);
  highp vec4 _ubottom = mix(_uindexedColorAt((_ubaseCoordinate + sc11)), _uindexedColorAt((_ubaseCoordinate + sc12)), _ublend.x);
  return mix(_utop, _ubottom, _ublend.y);
}
highp vec4 _usampleMaterial(){
  if ((_uuMaterialKind == 0))
  {
    return _uuMaterialColor;
  }
  if ((_uuMaterialKind == 1))
  {
    return texture(_uuBase, _uvTextureCoordinate);
  }
  return _usampleIndexedPaletteLinear(_uvTextureCoordinate);
}
void main(){
  (_uoutColor = vec4(0.0, 0.0, 0.0, 0.0));
  if ((!_uportalDeferredFragmentVisible()))
  {
    discard;
  }
  highp vec4 _ucolor = _usampleMaterial();
  const highp float sc13 = 1.0;
  (_ucolor.w *= ((sc13 - clamp(_uvTranslucency, 0.0, 1.0)) * _uuOpacityScale));
  if ((_ucolor.w < _uuAlphaTest))
  {
    discard;
  }
  (_uoutColor = _uencodeTransparentCanvasEmission(_ucolor, _uuCanvasEmissionMode));
}
