#version 300 es
uniform lowp sampler2D _uuBase;
uniform lowp sampler2D _uuPalette;
uniform highp float _uuAlphaTest;
uniform highp int _uuMaterialKind;
uniform highp vec4 _uuMaterialColor;
uniform highp int _uuPalettedClipMap;
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
  const highp float sbde = 1.0;
  const highp float sbdf = 1.0;
  highp float _usourceFactor = (((_umode == 1)) ? (sbde) : ((((_umode == 2)) ? (_ucolor.w) : ((sbdf - _ucolor.w)))));
  highp vec3 _uemission = max((_ucolor.xyz * _usourceFactor), vec3(0.0, 0.0, 0.0));
  highp float _ucoverage = clamp(max(_uemission.x, max(_uemission.y, _uemission.z)), 0.0, 1.0);
  const highp vec4 sbe0 = vec4(0.0, 0.0, 0.0, 0.0);
  return (((_ucoverage > 0.0)) ? (vec4((_uemission / _ucoverage), _ucoverage)) : (sbe0));
}
highp float _upaletteIndexAt(in highp ivec2 _utexel){
  highp ivec2 _usize = textureSize(_uuBase, 0);
  const highp ivec2 sbe1 = ivec2(1, 1);
  (_utexel = clamp(_utexel, ivec2(0, 0), (_usize - sbe1)));
  highp vec4 _uencoded = (texelFetch(_uuBase, _utexel, 0) * 255.0);
  const highp float sbe2 = 0.5;
  const highp float sbe3 = 0.5;
  const highp float sbe4 = 256.0;
  const highp float sbe5 = 0.5;
  return (((_uuMaterialKind == 3)) ? ((floor((_uencoded.x + sbe2)) + (floor((_uencoded.y + sbe3)) * sbe4))) : (floor((_uencoded.x + sbe5))));
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
  const highp vec2 sbe6 = vec2(0.5, 0.5);
  highp vec2 _utexelPosition = ((_uuv * vec2(_usourceSize)) - sbe6);
  highp ivec2 _ubaseCoordinate = ivec2(floor(_utexelPosition));
  highp vec2 _ublend = fract(_utexelPosition);
  const highp ivec2 sbe7 = ivec2(1, 0);
  highp vec4 _utop = mix(_uindexedColorAt(_ubaseCoordinate), _uindexedColorAt((_ubaseCoordinate + sbe7)), _ublend.x);
  const highp ivec2 sbe8 = ivec2(0, 1);
  const highp ivec2 sbe9 = ivec2(1, 1);
  highp vec4 _ubottom = mix(_uindexedColorAt((_ubaseCoordinate + sbe8)), _uindexedColorAt((_ubaseCoordinate + sbe9)), _ublend.x);
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
  const highp float sbea = 1.0;
  (_ucolor.w *= ((sbea - clamp(_uvTranslucency, 0.0, 1.0)) * _uuOpacityScale));
  if ((_ucolor.w < _uuAlphaTest))
  {
    discard;
  }
  (_uoutColor = _uencodeTransparentCanvasEmission(_ucolor, _uuCanvasEmissionMode));
}
