/* eslint-disable react/no-unknown-property */
import React, { forwardRef, useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { Canvas, useFrame, useThree, RootState } from '@react-three/fiber';
import { Color, Mesh, ShaderMaterial } from 'three';
import { IUniform } from 'three';

interface UniformValue<T = number | Color> {
  value: T;
}

interface SilkUniforms {
  uSpeed: UniformValue<number>;
  uScale: UniformValue<number>;
  uNoiseIntensity: UniformValue<number>;
  uColor: UniformValue<Color>;
  uRotation: UniformValue<number>;
  uTime: UniformValue<number>;
  [uniform: string]: IUniform;
}

const vertexShader = `
varying vec2 vUv;
varying vec3 vPosition;

void main() {
  vPosition = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
varying vec2 vUv;
varying vec3 vPosition;

uniform float uTime;
uniform vec3  uColor;
uniform float uSpeed;
uniform float uScale;
uniform float uRotation;
uniform float uNoiseIntensity;

// Smooth 2D noise
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float snoise(vec2 p) {
  const float K1 = 0.366025404; // (sqrt(3)-1)/2
  const float K2 = 0.211324865; // (3-sqrt(3))/6

  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  vec2 o = step(a.yx, a.xy);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;

  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n = h * h * h * h * vec3(dot(a, hash2(i)), dot(b, hash2(i + o)), dot(c, hash2(i + 1.0)));

  return dot(n, vec3(70.0));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2  rot = mat2(c, -s, s, c);
  return rot * uv;
}

void main() {
  vec2 uv = rotateUvs((vUv - 0.5) * uScale, uRotation) + 0.5;
  float t = uTime * uSpeed * 0.15;

  // Multi-layered fluid silk drape folds
  float wave1 = sin(uv.x * 4.0 + uv.y * 3.0 + t) * 0.5 + 0.5;
  float wave2 = cos(uv.x * 6.0 - uv.y * 4.0 - t * 0.7) * 0.5 + 0.5;
  float wave3 = sin(uv.x * 2.5 + sin(uv.y * 5.0 + t) + t * 0.4) * 0.5 + 0.5;
  
  float n = snoise(uv * 2.0 + vec2(t * 0.2, -t * 0.1)) * uNoiseIntensity * 0.15;

  float fold = wave1 * 0.45 + wave2 * 0.35 + wave3 * 0.2 + n;
  fold = clamp(fold, 0.0, 1.0);

  // Silk specular highlight on crests
  float sheen = pow(fold, 3.5) * 0.65;
  float deepShadow = pow(1.0 - fold, 2.0) * 0.45;

  // Multi-tone luxury silk color palette
  vec3 shadowCol = uColor * 0.35;
  vec3 midCol    = uColor;
  vec3 crestCol  = mix(uColor, vec3(1.0), 0.55);
  vec3 sheenCol  = vec3(1.0);

  // Smooth silk gradient blending
  vec3 col = mix(shadowCol, midCol, smoothstep(0.05, 0.55, fold));
  col = mix(col, crestCol, smoothstep(0.55, 0.95, fold));
  col += sheenCol * sheen;
  col = max(col - vec3(deepShadow * 0.3), vec3(0.0));

  // Subtle satin micro-shimmer
  float shimmer = snoise(uv * 18.0 + t) * 0.02 * uNoiseIntensity;
  col += vec3(shimmer);

  gl_FragColor = vec4(col, 1.0);
}
`;

interface SilkPlaneProps {
  uniforms: SilkUniforms;
}

const SilkPlane = forwardRef<Mesh, SilkPlaneProps>(function SilkPlane({ uniforms }, ref) {
  const { viewport } = useThree();

  useLayoutEffect(() => {
    const mesh = ref as React.MutableRefObject<Mesh | null>;
    if (mesh.current) {
      mesh.current.scale.set(viewport.width, viewport.height, 1);
    }
  }, [ref, viewport]);

  useFrame((_state: RootState, delta: number) => {
    uniforms.uTime.value += 0.1 * delta;
  });

  return (
    <mesh ref={ref}>
      <planeGeometry args={[1, 1, 1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
      />
    </mesh>
  );
});
SilkPlane.displayName = 'SilkPlane';

export interface SilkProps {
  speed?: number;
  scale?: number;
  color?: string;
  noiseIntensity?: number;
  rotation?: number;
}

const Silk: React.FC<SilkProps> = ({ speed = 10, scale = 1, color = '#7B7481', noiseIntensity = 1.5, rotation = 0 }) => {
  const meshRef = useRef<Mesh>(null);

  // Stable uniforms object created once
  const uniforms = useMemo<SilkUniforms>(
    () => ({
      uSpeed: { value: speed },
      uScale: { value: scale },
      uNoiseIntensity: { value: noiseIntensity },
      uColor: { value: new Color(color) },
      uRotation: { value: rotation },
      uTime: { value: 0 }
    }),
    [] // Empty dependencies to keep object stable
  );

  // Update uniform values when props change
  useEffect(() => {
    uniforms.uSpeed.value = speed;
    uniforms.uScale.value = scale;
    uniforms.uNoiseIntensity.value = noiseIntensity;
    uniforms.uColor.value.set(color);
    uniforms.uRotation.value = rotation;
  }, [speed, scale, noiseIntensity, color, rotation, uniforms]);

  return (
    <div className="absolute inset-0 -z-10 h-full w-full">
      <Canvas dpr={[1, 2]} frameloop="always" gl={{ alpha: true }}>
        <SilkPlane ref={meshRef} uniforms={uniforms} />
      </Canvas>
    </div>
  );
};

export default Silk;
