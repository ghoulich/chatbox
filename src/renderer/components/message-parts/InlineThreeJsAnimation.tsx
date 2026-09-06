import { Modal } from '@mantine/core'
import type { ThreeJsAnimationResult } from '@shared/threejs-animation-tool'
import { IconArrowsMaximize, IconPlayerPauseFilled, IconPlayerPlayFilled, IconRefresh } from '@tabler/icons-react'
import { type CSSProperties, type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import katexRuntimeSource from 'katex/dist/katex.min.js?raw'
import katexStylesSource from '../../static/katex-sandbox-0.16.28.min.css.txt?raw'
import threeRuntimeSource from '../../../../node_modules/three/build/three.cjs?raw'

const MAX_ANIMATION_CODE_LENGTH = 60_000
const katexFontDataUrls = import.meta.glob<string>('../../../../node_modules/katex/dist/fonts/*.woff2', {
  eager: true,
  import: 'default',
  query: '?inline',
})

export const THREE_JS_FULLSCREEN_MODAL_STYLES = {
  content: {
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    flex: '0 0 auto',
  },
  body: {
    display: 'flex',
    flex: '1 1 auto',
    minHeight: 0,
    padding: 0,
  },
}

export const THREE_JS_FULLSCREEN_SURFACE_STYLE: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  width: '100%',
}

export function resolveInlineThreeJsHeight(requestedHeight: number, viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return requestedHeight
  return Math.min(requestedHeight, Math.max(180, Math.round(viewportHeight * 0.62)))
}

function escapeInlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script').replace(/\/\/# sourceMappingURL=.*$/gm, '')
}

export function buildInlineKatexStyles(): string {
  let styles = katexStylesSource.replace(
    /,url\(fonts\/[^)]+\.woff\) format\("woff"\),url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g,
    ''
  )
  for (const [path, dataUrl] of Object.entries(katexFontDataUrls)) {
    const filename = path.slice(path.lastIndexOf('/') + 1)
    styles = styles.replaceAll(`fonts/${filename}`, dataUrl)
  }
  return styles.replace(/<\/style/gi, '<\\/style')
}

export function getInlineKatexBundleDiagnostics(): {
  runtimeBytes: number
  styleBytes: number
  fontCount: number
} {
  return {
    runtimeBytes: katexRuntimeSource.length,
    styleBytes: buildInlineKatexStyles().length,
    fontCount: Object.keys(katexFontDataUrls).length,
  }
}

let runnerUrl: string | undefined

function getRunnerUrl(): string {
  if (runnerUrl) return runnerUrl
  const runtime = escapeInlineScript(threeRuntimeSource)
  const katexRuntime = escapeInlineScript(katexRuntimeSource)
  const katexStyles = buildInlineKatexStyles()
  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; media-src 'none'; font-src data:; frame-src 'none'">
<style>
${katexStyles}
html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#0b1020;color:#eef2ff;font-family:system-ui,sans-serif}
#root{position:relative} canvas{display:block;width:100%;height:100%;touch-action:none;-webkit-tap-highlight-color:transparent}
#overlay{position:absolute;inset:0;overflow:hidden;pointer-events:none} #overlay>*{pointer-events:auto;box-sizing:border-box;max-width:calc(100% - 16px);max-height:calc(100% - 16px);overflow:auto}
.chatbox-three-formula{max-width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior-inline:contain}.chatbox-three-formula .katex-display{margin:.35em 0;overflow-x:auto;overflow-y:hidden}
@media (pointer:coarse){#overlay button,#overlay input[type=button],#overlay input[type=range],#overlay select{min-height:44px}#overlay button,#overlay input[type=button]{min-width:44px}#overlay{font-size:16px}}
#error{display:none;position:absolute;inset:0;padding:18px;overflow:auto;background:#190b0b;color:#fecaca;white-space:pre-wrap;font-size:13px}
#status{position:absolute;left:8px;bottom:8px;max-width:calc(100% - 16px);padding:4px 7px;border-radius:5px;background:#0009;color:#fff;font-size:11px}
</style></head><body><div id="root"><div id="overlay"></div><div id="status"></div><div id="error"></div></div>
<script>let module={exports:{}};let exports=module.exports;${katexRuntime}
const KATEX=module.exports;module={exports:{}};exports=module.exports;${runtime}
const THREE=module.exports;
const root=document.getElementById('root'),overlay=document.getElementById('overlay'),errorBox=document.getElementById('error'),statusBox=document.getElementById('status');
const nativeSetTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window),nativeSetInterval=window.setInterval.bind(window),nativeClearInterval=window.clearInterval.bind(window);
let renderer=null,scene=null,camera=null,frameCallbacks=[],resizeCallbacks=[],cleanupCallbacks=[],scheduledFrameCallbacks=new Map(),managedTimers=new Set(),formulaTargets=new WeakSet(),nextFrameId=1,formulaRenderCount=0,active=true,lastTime=0,startedAt=0,currentCode='';
function showError(error){errorBox.style.display='block';errorBox.textContent=String(error&&error.stack||error);parent.postMessage({type:'chatbox-three-error',message:String(error&&error.message||error)},'*')}
function clearManagedTimer(record){if(!record||!managedTimers.delete(record))return;if(record.kind==='interval')nativeClearInterval(record.nativeId);else nativeClearTimeout(record.nativeId)}
function dispose(){if(renderer)renderer.setAnimationLoop(null);for(const record of [...managedTimers])clearManagedTimer(record);scheduledFrameCallbacks.clear();for(const fn of cleanupCallbacks.splice(0)){try{fn()}catch{}}if(scene){scene.traverse((object)=>{try{object.geometry&&object.geometry.dispose&&object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials){if(!material)continue;for(const value of Object.values(material)){if(value&&value.isTexture&&value.dispose)value.dispose()}material.dispose&&material.dispose()}}catch{}})}if(renderer){try{renderer.dispose();renderer.forceContextLoss()}catch{}renderer.domElement.remove()}renderer=null;scene=null;camera=null;frameCallbacks=[];resizeCallbacks=[];formulaTargets=new WeakSet();formulaRenderCount=0;overlay.replaceChildren();errorBox.style.display='none';errorBox.textContent='';statusBox.textContent=''}
function getViewport(){const width=Math.max(1,root.clientWidth),height=Math.max(1,root.clientHeight);return{width,height,orientation:width>height?'landscape':height>width?'portrait':'square',touch:(navigator.maxTouchPoints||0)>0||!!window.matchMedia&&window.matchMedia('(pointer:coarse)').matches,devicePixelRatio:Math.min(window.devicePixelRatio||1,2)}}
function resize(){if(!renderer||!camera)return;const viewport=getViewport();renderer.setSize(viewport.width,viewport.height,false);camera.aspect=viewport.width/viewport.height;camera.updateProjectionMatrix();for(const callback of resizeCallbacks){try{callback(viewport)}catch(error){showError(error)}}}
function safeRequestAnimationFrame(callback){if(typeof callback!=='function')throw new Error('requestAnimationFrame requires a function.');if(scheduledFrameCallbacks.size>=32)throw new Error('At most 32 animation-frame callbacks may be pending.');const id=nextFrameId++;scheduledFrameCallbacks.set(id,callback);return id}
function safeCancelAnimationFrame(id){scheduledFrameCallbacks.delete(id)}
function scheduleTimer(kind,callback,delay,args){if(typeof callback!=='function')throw new Error(kind+' requires a function.');if(managedTimers.size>=32)throw new Error('At most 32 managed timers may be active.');const boundedDelay=Math.max(kind==='interval'?50:0,Math.min(600000,Number(delay)||0));const record={kind,nativeId:0};const invoke=()=>{if(kind==='timeout')managedTimers.delete(record);if(!active){if(kind==='timeout'){record.nativeId=nativeSetTimeout(invoke,50);managedTimers.add(record)}return}try{callback(...args)}catch(error){showError(error)}};record.nativeId=kind==='interval'?nativeSetInterval(invoke,boundedDelay):nativeSetTimeout(invoke,boundedDelay);managedTimers.add(record);return record}
function safeSetTimeout(callback,delay,...args){return scheduleTimer('timeout',callback,delay,args)}function safeSetInterval(callback,delay,...args){return scheduleTimer('interval',callback,delay,args)}
function renderFormula(target,latex,options){if(!(target instanceof Element))throw new Error('api.renderFormula target must be a DOM element.');if(!overlay.contains(target))throw new Error('api.renderFormula target must be inside api.overlay.');if(!formulaTargets.has(target)){if(formulaRenderCount>=64)throw new Error('At most 64 formula elements may be rendered.');formulaTargets.add(target);formulaRenderCount+=1}const expression=String(latex||'');if(!expression.trim())throw new Error('api.renderFormula requires a non-empty LaTeX expression.');if(expression.length>4000)throw new Error('A formula may contain at most 4,000 characters.');target.classList.add('chatbox-three-formula');KATEX.render(expression,target,{displayMode:!!(options&&options.displayMode),throwOnError:false,trust:false,strict:'error',output:'htmlAndMathml',maxSize:20,maxExpand:1000,errorColor:'#fca5a5'});return target}
function setLoop(){if(!renderer)return;renderer.setAnimationLoop(active?tick:null);if(active){lastTime=performance.now();renderer.render(scene,camera)}}
function tick(time){if(!renderer||!scene||!camera||!active)return;const delta=Math.min(.1,Math.max(0,(time-lastTime)/1000));lastTime=time;const elapsed=(time-startedAt)/1000;const scheduled=[...scheduledFrameCallbacks.values()];scheduledFrameCallbacks.clear();for(const callback of scheduled){try{callback(time)}catch(error){showError(error);active=false;setLoop();return}}const frameInfo={time,delta,elapsed,valueOf(){return delta},toString(){return String(delta)},[Symbol.toPrimitive](){return delta}};for(const callback of frameCallbacks){try{callback(frameInfo)}catch(error){showError(error);active=false;setLoop();return}}renderer.render(scene,camera)}
function enableOrbitControls(targetValue){const target=targetValue&&targetValue.isVector3?targetValue:new THREE.Vector3();const initialTarget=target.clone(),initialPosition=camera.position.clone();const pointers=new Map();let lastX=0,lastY=0,pinchDistance=0;let offset=camera.position.clone().sub(target);let spherical=new THREE.Spherical().setFromVector3(offset);const apply=()=>{spherical.phi=Math.max(.08,Math.min(Math.PI-.08,spherical.phi));spherical.radius=Math.max(.5,Math.min(100,spherical.radius));camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical));camera.lookAt(target)};const distance=()=>{const values=[...pointers.values()];return values.length<2?0:Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y)};const down=(event)=>{event.preventDefault();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture&&canvas.setPointerCapture(event.pointerId);if(pointers.size===1){lastX=event.clientX;lastY=event.clientY}else if(pointers.size===2){pinchDistance=distance()}};const move=(event)=>{if(!pointers.has(event.pointerId))return;event.preventDefault();const samples=event.getCoalescedEvents?event.getCoalescedEvents():[event];const sample=samples[samples.length-1]||event;pointers.set(event.pointerId,{x:sample.clientX,y:sample.clientY});if(pointers.size===1){const dx=sample.clientX-lastX,dy=sample.clientY-lastY;lastX=sample.clientX;lastY=sample.clientY;spherical.theta-=dx*(event.pointerType==='touch'?.006:.008);spherical.phi-=dy*(event.pointerType==='touch'?.006:.008);apply()}else{const nextDistance=distance();if(pinchDistance>0&&nextDistance>0){spherical.radius*=pinchDistance/nextDistance;apply()}pinchDistance=nextDistance}};const up=(event)=>{pointers.delete(event.pointerId);if(canvas.hasPointerCapture&&canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);pinchDistance=pointers.size>=2?distance():0;const remaining=[...pointers.values()][0];if(remaining){lastX=remaining.x;lastY=remaining.y}};const wheel=(event)=>{event.preventDefault();spherical.radius*=Math.exp(event.deltaY*.001);apply()};const reset=()=>{target.copy(initialTarget);camera.position.copy(initialPosition);spherical=new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));apply()};const canvas=renderer.domElement;canvas.style.touchAction='none';canvas.addEventListener('pointerdown',down,{passive:false});canvas.addEventListener('pointermove',move,{passive:false});canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('lostpointercapture',up);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('dblclick',reset);cleanupCallbacks.push(()=>{canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('lostpointercapture',up);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('dblclick',reset)});apply();return{target,update:apply,reset}}
function initialize(code){dispose();currentCode=code;try{if(typeof WebGL2RenderingContext==='undefined')throw new Error('WebGL 2 is not available on this device. Update Android System WebView or use a newer device.');scene=new THREE.Scene();scene.background=new THREE.Color(0x0b1020);camera=new THREE.PerspectiveCamera(45,1,.01,1000);camera.position.set(7,5,9);camera.lookAt(0,0,0);renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;root.insertBefore(renderer.domElement,overlay);const ambient=new THREE.HemisphereLight(0xffffff,0x334155,1.5);scene.add(ambient);const key=new THREE.DirectionalLight(0xffffff,2);key.position.set(5,8,6);scene.add(key);const api={scene,camera,renderer,overlay,getViewport,onFrame(fn){if(typeof fn!=='function'||frameCallbacks.length>=16)throw new Error('At most 16 frame callbacks are allowed.');frameCallbacks.push(fn)},onResize(fn){if(typeof fn!=='function'||resizeCallbacks.length>=16)throw new Error('At most 16 resize callbacks are allowed.');resizeCallbacks.push(fn);fn(getViewport())},onCleanup(fn){if(typeof fn==='function')cleanupCallbacks.push(fn)},enableOrbitControls,renderFormula,setStatus(text){statusBox.textContent=String(text||'')},setBackground(color){scene.background=new THREE.Color(color)}};const factory=new Function('THREE','api','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout','setInterval','clearInterval','"use strict";\\n'+code+'\\n//# sourceURL=chatbox-three-animation.js');const returned=factory(THREE,api,safeRequestAnimationFrame,safeCancelAnimationFrame,safeSetTimeout,clearManagedTimer,safeSetInterval,clearManagedTimer);if(typeof returned==='function')cleanupCallbacks.push(returned);resize();startedAt=performance.now();lastTime=startedAt;setLoop();parent.postMessage({type:'chatbox-three-ready'},'*')}catch(error){showError(error)}}
addEventListener('resize',resize);addEventListener('message',(event)=>{if(event.source!==parent)return;const data=event.data||{};if(data.type==='chatbox-three-init'&&typeof data.code==='string')initialize(data.code);else if(data.type==='chatbox-three-active'){active=!!data.active;setLoop()}else if(data.type==='chatbox-three-restart')initialize(currentCode)});addEventListener('unload',dispose);
</script></body></html>`
  runnerUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  return runnerUrl
}

export function extractThreeJsAnimation(value: unknown): ThreeJsAnimationResult | undefined {
  if (!value || typeof value !== 'object') return undefined
  const result = value as Record<string, unknown>
  if (
    typeof result.animationId !== 'string' ||
    typeof result.title !== 'string' ||
    typeof result.description !== 'string' ||
    typeof result.code !== 'string' ||
    result.code.length === 0 ||
    result.code.length > MAX_ANIMATION_CODE_LENGTH ||
    typeof result.height !== 'number' ||
    result.height < 220 ||
    result.height > 640 ||
    typeof result.url !== 'string' ||
    !result.url.startsWith('https://animation.chatbox.local/')
  ) {
    return undefined
  }
  return result as unknown as ThreeJsAnimationResult
}

export function collectThreeJsAnimations(
  parts: Array<{ type?: string; toolName?: string; result?: unknown }>
): ThreeJsAnimationResult[] {
  const animations: ThreeJsAnimationResult[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    if (part.type !== 'tool-call' || part.toolName !== 'create_threejs_animation') continue
    const animation = extractThreeJsAnimation(part.result)
    if (!animation || seen.has(animation.animationId)) continue
    seen.add(animation.animationId)
    animations.push(animation)
  }
  return animations
}

const AnimationSurface: FC<{
  result: ThreeJsAnimationResult
  active: boolean
  className?: string
  style?: CSSProperties
}> = ({ result, active, className, style }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState('')
  const send = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === 'chatbox-three-error') setError(String(event.data.message || 'Animation failed'))
      if (event.data?.type === 'chatbox-three-ready') setError('')
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])

  useEffect(() => send({ type: 'chatbox-three-active', active }), [active, send])

  return (
    <span className={`relative block overflow-hidden bg-[#0b1020] ${className || ''}`} style={style}>
      <iframe
        ref={iframeRef}
        src={getRunnerUrl()}
        title={result.title}
        sandbox="allow-scripts"
        className="block h-full w-full border-0"
        onLoad={() => {
          send({ type: 'chatbox-three-init', code: result.code })
          send({ type: 'chatbox-three-active', active })
        }}
      />
      {error && (
        <span className="absolute inset-x-0 bottom-0 block bg-red-950/90 px-3 py-2 text-xs text-red-100">{error}</span>
      )}
    </span>
  )
}

export const InlineThreeJsAnimation: FC<{ result: ThreeJsAnimationResult }> = ({ result }) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLSpanElement>(null)
  const [intersecting, setIntersecting] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(document.visibilityState === 'visible')
  const [playing, setPlaying] = useState(true)
  const [restartKey, setRestartKey] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [viewportHeight, setViewportHeight] = useState(
    () => window.visualViewport?.height || window.innerHeight || result.height
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setIntersecting(Boolean(entry?.isIntersecting)), {
      rootMargin: '120px',
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    const update = () => setViewportHeight(window.visualViewport?.height || window.innerHeight || result.height)
    const visualViewport = window.visualViewport
    window.addEventListener('resize', update)
    visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      visualViewport?.removeEventListener('resize', update)
    }
  }, [result.height])

  const active = intersecting && documentVisible && playing && !fullscreen
  const frameStyle = useMemo(
    () => ({ height: resolveInlineThreeJsHeight(result.height, viewportHeight) }),
    [result.height, viewportHeight]
  )

  return (
    <span
      ref={containerRef}
      className="my-3 block w-full max-w-3xl overflow-hidden rounded-lg border border-chatbox-border-primary bg-chatbox-background-secondary"
    >
      <span className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-chatbox-tint-primary">{result.title}</span>
          {result.description && (
            <span className="mt-0.5 block text-xs text-chatbox-tint-secondary">{result.description}</span>
          )}
        </span>
        <span className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label={String(playing ? t('Pause animation') : t('Play animation'))}
            className="rounded border-0 bg-chatbox-background-gray-secondary p-2 text-chatbox-tint-primary"
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
          </button>
          <button
            type="button"
            aria-label={String(t('Restart animation'))}
            className="rounded border-0 bg-chatbox-background-gray-secondary p-2 text-chatbox-tint-primary"
            onClick={() => setRestartKey((value) => value + 1)}
          >
            <IconRefresh size={16} />
          </button>
          <button
            type="button"
            aria-label={String(t('Fullscreen'))}
            className="rounded border-0 bg-chatbox-background-gray-secondary p-2 text-chatbox-tint-primary"
            onClick={() => setFullscreen(true)}
          >
            <IconArrowsMaximize size={16} />
          </button>
        </span>
      </span>
      <AnimationSurface key={restartKey} result={result} active={active} style={frameStyle} />

      <Modal
        opened={fullscreen}
        onClose={() => setFullscreen(false)}
        title={result.title}
        fullScreen
        styles={THREE_JS_FULLSCREEN_MODAL_STYLES}
      >
        <AnimationSurface result={result} active={fullscreen && playing} style={THREE_JS_FULLSCREEN_SURFACE_STYLE} />
      </Modal>
    </span>
  )
}
