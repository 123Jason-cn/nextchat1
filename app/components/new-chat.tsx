import { useEffect, useRef, useState, useCallback } from "react";
import { Path, SlotID } from "../constant";
import { IconButton } from "./button";
import { EmojiAvatar } from "./emoji";
import styles from "./new-chat.module.scss";

import LeftIcon from "../icons/left.svg";
import LightningIcon from "../icons/lightning.svg";
import EyeIcon from "../icons/eye.svg";

import { useLocation, useNavigate } from "react-router-dom";
import { Mask, useMaskStore } from "../store/mask";
import Locale from "../locales";
import { useAppConfig, useChatStore } from "../store";
import { MaskAvatar } from "./mask";
import { useCommand } from "../command";
import { showConfirm } from "./ui-lib";
import { BUILTIN_MASK_STORE } from "../masks";
import clsx from "clsx";

function MaskItem(props: { mask: Mask; onClick?: () => void }) {
  return (
    <div className={styles["mask"]} onClick={props.onClick}>
      <MaskAvatar
        avatar={props.mask.avatar}
        model={props.mask.modelConfig.model}
      />
      <div className={clsx(styles["mask-name"], "one-line")}>
        {props.mask.name}
      </div>
    </div>
  );
}

function useMaskGroup(masks: Mask[], activeTab: 'SYSTEM' | 'MCN') {
  const [masksArray, setMasksArray] = useState<Mask[]>([]);
  
  // 使用 useRef 存储上一次的计算结果，避免重复计算
  const lastCalculation = useRef({
    width: 0,
    height: 0,
    masksLength: 0,
    activeTab: '',
  });

  const computeGroup = useCallback(() => {
    const appBody = document.getElementById(SlotID.AppBody);
    if (!appBody || !masks || masks.length === 0) {
      setMasksArray([]);
      return;
    }

    const rect = appBody.getBoundingClientRect();
    const currentWidth = Math.floor(rect.width);
    const currentHeight = Math.floor(rect.height * 0.6);

    // 检查是否需要重新计算
    const shouldRecalculate = 
      currentWidth !== lastCalculation.current.width ||
      currentHeight !== lastCalculation.current.height ||
      masks.length !== lastCalculation.current.masksLength ||
      activeTab !== lastCalculation.current.activeTab;

    if (!shouldRecalculate) {
      return;
    }

    // 更新最后一次计算的参数
    lastCalculation.current = {
      width: currentWidth,
      height: currentHeight,
      masksLength: masks.length,
      activeTab,
    };

    // 直接返回一维数组
    setMasksArray([...masks]);
  }, [masks, activeTab]);

  // 使用 useRef 存储防抖函数
  const debouncedCompute = useRef(
    debounce(() => {
      requestAnimationFrame(computeGroup);
    }, 200)
  ).current;

  // 只在组件挂载和依赖项变化时设置事件监听
  useEffect(() => {
    // 初始计算
    computeGroup();

    window.addEventListener("resize", debouncedCompute);
    return () => {
      window.removeEventListener("resize", debouncedCompute);
      debouncedCompute.cancel?.();
    };
  }, [computeGroup, debouncedCompute]);

  return masksArray;
}

// 防抖函数实现
const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  
  const debouncedFn = (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), wait);
  };

  debouncedFn.cancel = () => {
    clearTimeout(timeoutId);
  };

  return debouncedFn;
};

export function NewChat() {
  const chatStore = useChatStore();
  const maskStore = useMaskStore();

  const masks = maskStore.getAll();

  const [activeTab, setActiveTab] = useState<'SYSTEM' | 'MCN'>('MCN');

  console.log("[New Chat] masks", masks, activeTab);

  const filteredMasks = masks.filter(mask => 
    activeTab === 'SYSTEM' ? !mask?.modelType?.includes('MCN') : mask?.modelType?.includes('MCN')
  );

  console.log("[New Chat] filteredMasks", filteredMasks);

  const masksArray = useMaskGroup(filteredMasks, activeTab);

  console.log("[New Chat] masksArray", masksArray);

  // const groups = useMaskGroup(masks);

  const navigate = useNavigate();
  const config = useAppConfig();

  const maskRef = useRef<HTMLDivElement>(null);

  const { state } = useLocation();

  const startChat = (mask?: Mask) => {
    setTimeout(() => {
      chatStore.newSession(mask);
      navigate(Path.Chat);
    }, 10);
  };

  useCommand({
    mask: (id) => {
      try {
        const mask = maskStore.get(id) ?? BUILTIN_MASK_STORE.get(id);
        startChat(mask ?? undefined);
      } catch {
        console.error("[New Chat] failed to create chat from mask id=", id);
      }
    },
  });

  useEffect(() => {
    if (maskRef.current) {
      maskRef.current.scrollLeft =
        (maskRef.current.scrollWidth - maskRef.current.clientWidth) / 2;
    }
  }, [masksArray]);

  return (
    <div className={styles["new-chat"]}>
      <div className={styles["mask-header"]}>
        <IconButton
          icon={<LeftIcon />}
          text={Locale.NewChat.Return}
          onClick={() => navigate(Path.Home)}
        ></IconButton>
        {!state?.fromHome && (
          <IconButton
            text={Locale.NewChat.NotShow}
            onClick={async () => {
              if (await showConfirm(Locale.NewChat.ConfirmNoShow)) {
                startChat();
                config.update(
                  (config) => (config.dontShowMaskSplashScreen = true),
                );
              }
            }}
          ></IconButton>
        )}
      </div>
      <div className={styles["mask-cards"]}>
        <div className={styles["mask-card"]}>
          <EmojiAvatar avatar="1f606" size={24} />
        </div>
        <div className={styles["mask-card"]}>
          <EmojiAvatar avatar="1f916" size={24} />
        </div>
        <div className={styles["mask-card"]}>
          <EmojiAvatar avatar="1f479" size={24} />
        </div>
      </div>

      <div className={styles["title"]}>{Locale.NewChat.Title}</div>
      <div className={styles["sub-title"]}>{Locale.NewChat.SubTitle}</div>

      <div className={styles["actions"]}>
        {/* 添加tabs标签 */}
        <div className={styles["tabs"]}>
          <div 
            className={clsx(styles["tab"], activeTab === 'MCN' && styles["active"])} 
            onClick={() => setActiveTab('MCN')}
          >
            MCN角色
          </div>
          <div
            className={clsx(styles["tab"], activeTab === 'SYSTEM' && styles["active"])} 
            onClick={() => setActiveTab('SYSTEM')}
          >
            通用角色
          </div>
        </div>

        <IconButton
          text={Locale.NewChat.More}
          onClick={() => navigate(Path.Masks)}
          icon={<EyeIcon />}
          bordered
          shadow
        />

        <IconButton
          text={Locale.NewChat.Skip}
          onClick={() => startChat()}
          icon={<LightningIcon />}
          type="primary"
          shadow
          className={styles["skip"]}
        />
      </div>

      <div className={styles["masks"]} ref={maskRef}>
        <div className={styles["mask-row"]}>
          {masksArray.map((mask, index) => (
            <MaskItem
              key={index}
              mask={mask}
              onClick={() => startChat(mask)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
