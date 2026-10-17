#version 300 es
uniform lowp sampler2D _uuBase;
uniform lowp sampler2D _uuPalette;
uniform highp int _uuDiagnosticSpatialMode;
uniform highp vec4 _uuDiagnosticAffected;
uniform highp int _uuDiagnosticLayerCounter;
uniform highp int _uuMaterialKind;
uniform highp vec4 _uuMaterialColor;
uniform highp int _uuPalettedClipMap;
uniform highp float _uuAlphaTest;
uniform highp float _uuOpacityScale;
uniform highp int _uuCanvasEmissionMode;
in highp vec2 _uvTextureCoordinate;
in highp float _uvTranslucency;
out highp vec4 _uoutColor;
highp vec4 _uencodeTransparentCanvasEmission(in highp vec4 _ucolor, in highp int _umode){
  if ((_umode == 0))
  {
    return _ucolor;
  }
  const highp float sbe1 = 1.0;
  const highp float sbe2 = 1.0;
  highp float _usourceFactor = (((_umode == 1)) ? (sbe1) : ((((_umode == 2)) ? (_ucolor.w) : ((sbe2 - _ucolor.w)))));
  highp vec3 _uemission = max((_ucolor.xyz * _usourceFactor), vec3(0.0, 0.0, 0.0));
  highp float _ucoverage = clamp(max(_uemission.x, max(_uemission.y, _uemission.z)), 0.0, 1.0);
  const highp vec4 sbe3 = vec4(0.0, 0.0, 0.0, 0.0);
  return (((_ucoverage > 0.0)) ? (vec4((_uemission / _ucoverage), _ucoverage)) : (sbe3));
}
highp float _upaletteIndexAt(in highp ivec2 _utexel){
  highp ivec2 _usize = textureSize(_uuBase, 0);
  const highp ivec2 sbe4 = ivec2(1, 1);
  (_utexel = clamp(_utexel, ivec2(0, 0), (_usize - sbe4)));
  highp vec4 _uencoded = (texelFetch(_uuBase, _utexel, 0) * 255.0);
  const highp float sbe5 = 0.5;
  const highp float sbe6 = 0.5;
  const highp float sbe7 = 256.0;
  const highp float sbe8 = 0.5;
  return (((_uuMaterialKind == 3)) ? ((floor((_uencoded.x + sbe5)) + (floor((_uencoded.y + sbe6)) * sbe7))) : (floor((_uencoded.x + sbe8))));
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
  const highp vec2 sbe9 = vec2(0.5, 0.5);
  highp vec2 _utexelPosition = ((_uuv * vec2(_usourceSize)) - sbe9);
  highp ivec2 _ubaseCoordinate = ivec2(floor(_utexelPosition));
  highp vec2 _ublend = fract(_utexelPosition);
  const highp ivec2 sbea = ivec2(1, 0);
  highp vec4 _utop = mix(_uindexedColorAt(_ubaseCoordinate), _uindexedColorAt((_ubaseCoordinate + sbea)), _ublend.x);
  const highp ivec2 sbeb = ivec2(0, 1);
  const highp ivec2 sbec = ivec2(1, 1);
  highp vec4 _ubottom = mix(_uindexedColorAt((_ubaseCoordinate + sbeb)), _uindexedColorAt((_ubaseCoordinate + sbec)), _ublend.x);
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
  highp vec4 _ucolor = _usampleMaterial();
  const highp float sbed = 1.0;
  (_ucolor.w *= ((sbed - clamp(_uvTranslucency, 0.0, 1.0)) * _uuOpacityScale));
  if ((_ucolor.w < _uuAlphaTest))
  {
    discard;
  }
  (_uoutColor = _uencodeTransparentCanvasEmission(_ucolor, _uuCanvasEmissionMode));
}
