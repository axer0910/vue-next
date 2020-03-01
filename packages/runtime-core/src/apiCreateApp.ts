import {
  Component,
  Data,
  validateComponentName,
  PublicAPIComponent
} from './component'
import { ComponentOptions } from './apiOptions'
import { ComponentPublicInstance } from './componentProxy'
import { Directive, validateDirectiveName } from './directives'
import { RootRenderFunction } from './renderer'
import { InjectionKey } from './apiInject'
import { isFunction, NO, isObject } from '@vue/shared'
import { warn } from './warning'
import { createVNode, cloneVNode, VNode } from './vnode'

export interface App<HostElement = any> {
  config: AppConfig
  use(plugin: Plugin, ...options: any[]): this
  mixin(mixin: ComponentOptions): this
  component(name: string): Component | undefined
  component(name: string, component: Component): this
  directive(name: string): Directive | undefined
  directive(name: string, directive: Directive): this
  mount(
    rootContainer: HostElement | string,
    isHydrate?: boolean
  ): ComponentPublicInstance
  unmount(rootContainer: HostElement | string): void
  provide<T>(key: InjectionKey<T> | string, value: T): this

  // internal. We need to expose these for the server-renderer
  _component: Component
  _props: Data | null
  _container: HostElement | null
  _context: AppContext
}

export interface AppConfig {
  devtools: boolean
  performance: boolean
  readonly isNativeTag?: (tag: string) => boolean
  isCustomElement?: (tag: string) => boolean
  errorHandler?: (
    err: Error,
    instance: ComponentPublicInstance | null,
    info: string
  ) => void
  warnHandler?: (
    msg: string,
    instance: ComponentPublicInstance | null,
    trace: string
  ) => void
}

export interface AppContext {
  config: AppConfig
  mixins: ComponentOptions[]
  components: Record<string, Component>
  directives: Record<string, Directive>
  provides: Record<string | symbol, any>
  reload?: () => void // HMR only
}

type PluginInstallFunction = (app: App, ...options: any[]) => any

export type Plugin =
  | PluginInstallFunction & { install?: PluginInstallFunction }
  | {
      install: PluginInstallFunction
    }

export function createAppContext(): AppContext {
  return {
    config: {
      devtools: true,
      performance: false,
      isNativeTag: NO,
      isCustomElement: NO,
      errorHandler: undefined,
      warnHandler: undefined
    },
    mixins: [],
    components: {},
    directives: {},
    provides: Object.create(null)
  }
}

export type CreateAppFunction<HostElement> = (
  rootComponent: PublicAPIComponent,
  rootProps?: Data | null
) => App<HostElement>

export function createAppAPI<HostNode, HostElement>(
  render: RootRenderFunction<HostNode, HostElement>,
  hydrate?: (vnode: VNode, container: Element) => void
): CreateAppFunction<HostElement> {
  return function createApp(rootComponent: Component, rootProps = null) {
    // 第一个rootComponent就是用户编写的组件配置（template配置，setup()或者传统的mounted()等）
    // 第二个就是组件props配置
    if (rootProps != null && !isObject(rootProps)) {
      __DEV__ && warn(`root props passed to app.mount() must be an object.`)
      rootProps = null
    }

    const context = createAppContext()
    const installedPlugins = new Set()

    let isMounted = false

    const app: App = {
      _component: rootComponent,
      _props: rootProps,
      _container: null,
      _context: context,

      get config() {
        return context.config
      },

      set config(v) {
        if (__DEV__) {
          warn(
            `app.config cannot be replaced. Modify individual options instead.`
          )
        }
      },

      // 插件安装
      use(plugin: Plugin, ...options: any[]) {
        if (installedPlugins.has(plugin)) {
          __DEV__ && warn(`Plugin has already been applied to target app.`)
        } else if (plugin && isFunction(plugin.install)) {
          installedPlugins.add(plugin)
          plugin.install(app, ...options)
        } else if (isFunction(plugin)) {
          installedPlugins.add(plugin)
          plugin(app, ...options)
        } else if (__DEV__) {
          warn(
            `A plugin must either be a function or an object with an "install" ` +
              `function.`
          )
        }
        return app
      },

      // 传统的mixin
      mixin(mixin: ComponentOptions) {
        if (__FEATURE_OPTIONS__) {
          if (!context.mixins.includes(mixin)) {
            context.mixins.push(mixin)
          } else if (__DEV__) {
            warn(
              'Mixin has already been applied to target app' +
                (mixin.name ? `: ${mixin.name}` : '')
            )
          }
        } else if (__DEV__) {
          warn('Mixins are only available in builds supporting Options API')
        }
        return app
      },

      // 组件注册
      component(name: string, component?: PublicAPIComponent): any {
        if (__DEV__) {
          validateComponentName(name, context.config)
        }
        if (!component) {
          return context.components[name]
        }
        if (__DEV__ && context.components[name]) {
          warn(`Component "${name}" has already been registered in target app.`)
        }
        context.components[name] = component as Component
        return app
      },

      // 注册指令
      directive(name: string, directive?: Directive) {
        if (__DEV__) {
          validateDirectiveName(name)
        }

        if (!directive) {
          return context.directives[name] as any
        }
        if (__DEV__ && context.directives[name]) {
          warn(`Directive "${name}" has already been registered in target app.`)
        }
        context.directives[name] = directive
        return app
      },

      // 挂载组件
      // 将模板代码进行编译，component选项转成VNode后调用render进行渲染
      // 实际上这个时候vnode里面包含着组件创建选项(Component对象)
      mount(rootContainer: HostElement, isHydrate?: boolean): any {
        if (!isMounted) {
          // 这里的vnode包含着选项配置，模板字符串等初始信息
          // 后面才进行初始化
          const vnode = createVNode(rootComponent, rootProps)
          // store app context on the root VNode.
          // this will be set on the root instance on initial mount.
          vnode.appContext = context

          // HMR root reload
          if (__BUNDLER__ && __DEV__) {
            context.reload = () => {
              render(cloneVNode(vnode), rootContainer)
            }
          }

          if (isHydrate && hydrate) {
            hydrate(vnode, rootContainer as any)
          } else {
            // 将含有模板信息和配置的vnode进行渲染
            // 此时还没解析模板
            render(vnode, rootContainer)
          }
          isMounted = true
          app._container = rootContainer
          return vnode.component!.proxy
        } else if (__DEV__) {
          warn(
            `App has already been mounted. Create a new app instance instead.`
          )
        }
      },

      unmount() {
        if (isMounted) {
          render(null, app._container)
        } else if (__DEV__) {
          warn(`Cannot unmount an app that is not mounted.`)
        }
      },

      provide(key, value) {
        if (__DEV__ && key in context.provides) {
          warn(
            `App already provides property with key "${key}". ` +
              `It will be overwritten with the new value.`
          )
        }
        // TypeScript doesn't allow symbols as index type
        // https://github.com/Microsoft/TypeScript/issues/24587
        context.provides[key as string] = value

        return app
      }
    }

    return app
  }
}
