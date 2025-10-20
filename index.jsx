import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
    getFirestore, doc, setDoc, collection, query, limit, onSnapshot, getDoc, updateDoc
} from 'firebase/firestore';

// --- Global Firebase Variables (Provided by Canvas Environment) ---
// --- 전역 Firebase 변수 선언 (Canvas 환경에서 제공됨) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' 
    ? JSON.parse(__firebase_config) : {}; 
const initialAuthToken = typeof __initial_auth_token !== 'undefined' 
    ? __initial_auth_token : null;

// Problem Data (Hardcoded Example Problems)
// 문제 데이터 (하드코딩된 예시 문제)
const CHOSUNG_QUESTIONS = [
    { chosung: 'ㅇㄴㅎㅅㅇ', category: '인사말', answer: '안녕하세요', difficulty: 1 },
    { chosung: 'ㄱㅈ', category: '간식', answer: '과자', difficulty: 2 }, 
    { chosung: 'ㅁㄱ', category: '동물', answer: '몽구', difficulty: 2 },
    // 수정: '스마트폰' 초성 ㅅㅁㄹㅌㅍ -> ㅅㅁㅌㅍ
    { chosung: 'ㅅㅁㅌㅍ', category: '기술', answer: '스마트폰', difficulty: 3 },
    // 수정: '제주도' 초성 ㅈㅅㅇㄷ -> ㅈㅈㄷ
    { chosung: 'ㅈㅈㄷ', category: '도시', answer: '제주도', difficulty: 3 },
    { chosung: 'ㅅㅂ', category: '과일', 'answer': '수박', difficulty: 1 }, 
    { chosung: 'ㄴㄱ', category: '지리', 'answer': '남극', difficulty: 2 },
    { chosung: 'ㅇㅍㅌ', category: '건축', 'answer': '아파트', difficulty: 1 },
    { chosung: 'ㅍㅇㄴ', category: '악기', 'answer': '피아노', difficulty: 3 }, 
    // 수정: '된장찌개' 초성 ㄷㄱㅊㅈ -> ㄷㅈㅉㄱ
    { chosung: 'ㄷㅈㅉㄱ', category: '요리', 'answer': '된장찌개', difficulty: 2 },
];

const TIMER_START = 10; // Time limit per question (seconds)
const MAX_QUESTIONS = 5; // Number of questions per game

// Firestore Path and Utilities
const getPublicRankingPath = (docId) => `artifacts/${appId}/public/data/chosung_rankings/${docId}`;

const App = () => {
    // Firebase State
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [nickname, setNickname] = useState('게스트');
    const [isAuthReady, setIsAuthReady] = useState(false);

    // Game State
    const [phase, setPhase] = useState('start'); // 'start', 'playing', 'result', 'ranking'
    const [score, setScore] = useState(0);
    const [highScore, setHighScore] = useState(0);
    const [timeLeft, setTimeLeft] = useState(TIMER_START);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [currentQuestion, setCurrentQuestion] = useState(null);
    const [answerInput, setAnswerInput] = useState('');
    const [feedback, setFeedback] = useState({ text: '', type: '' }); // 'correct' or 'wrong'
    const [isNewHighScore, setIsNewHighScore] = useState(false);
    
    // State for showing the correct answer after a wrong attempt
    // 오답 시 정답 표시 상태
    const [showAnswer, setShowAnswer] = useState(false); 
    const [correctAnswerText, setCorrectAnswerText] = useState('');
    const [lastWrongInput, setLastWrongInput] = useState(''); // 사용자의 오답을 저장하는 새로운 상태

    // Ranking State
    const [rankingData, setRankingData] = useState([]);
    const [myRank, setMyRank] = useState(null);

    const timerRef = useRef(null);

    // 1. Firebase Initialization and Authentication
    useEffect(() => {
        if (!Object.keys(firebaseConfig).length) {
            console.error("Firebase config is missing.");
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const authentication = getAuth(app);

            setDb(firestore);
            setAuth(authentication);

            onAuthStateChanged(authentication, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    // Assign default nickname to anonymous user
                    // 익명 사용자에게 기본 닉네임 할당
                    setNickname(`플레이어-${user.uid.substring(0, 4)}`);
                } else {
                    // Attempt anonymous sign-in if no auth token is provided
                    // 인증 토큰이 없을 경우 익명 로그인 시도
                    if (initialAuthToken) {
                        await signInWithCustomToken(authentication, initialAuthToken);
                    } else {
                        await signInAnonymously(authentication);
                    }
                }
                setIsAuthReady(true);
            });
        } catch (error) {
            console.error("Firebase initialization failed:", error);
        }
    }, []);

    // 2. Load High Score and Set up Ranking Listener
    useEffect(() => {
        if (!db || !userId || !isAuthReady) return;

        // Load personal high score and set nickname
        // 개인 최고 점수 로드 및 닉네임 설정
        const loadUserData = async () => {
            const userDocRef = doc(db, getPublicRankingPath(userId));
            const userDocSnap = await getDoc(userDocRef);

            if (userDocSnap.exists()) {
                const data = userDocSnap.data();
                setHighScore(data.highScore || 0);
                setNickname(data.nickname || `플레이어-${userId.substring(0, 4)}`);
            } else {
                // Register new user
                // 새 사용자 등록
                await setDoc(userDocRef, {
                    userId: userId,
                    nickname: `플레이어-${userId.substring(0, 4)}`,
                    highScore: 0,
                    lastUpdated: new Date()
                });
            }
        };

        loadUserData();

        // Set up real-time ranking listener
        // 실시간 랭킹 리스너 설정
        const rankingsColRef = collection(db, `artifacts/${appId}/public/data/chosung_rankings`);
        const q = query(rankingsColRef, limit(100)); // Query top 100

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const currentRankings = [];
            let myIndex = -1;

            snapshot.docs.forEach((d, index) => {
                const data = d.data();
                const rank = index + 1;

                currentRankings.push({
                    rank,
                    ...data,
                });

                if (data.userId === userId) {
                    myIndex = index;
                }
            });

            // Sort by score descending (client-side sorting)
            // 점수 기준으로 내림차순 정렬 (클라이언트에서 정렬)
            currentRankings.sort((a, b) => b.highScore - a.highScore);
            
            // Find my rank
            // 나의 순위 찾기
            const finalRankings = currentRankings.map((data, index) => {
                if (data.userId === userId) {
                    setMyRank({ rank: index + 1, score: data.highScore });
                }
                return { ...data, rank: index + 1 };
            });

            setRankingData(finalRankings);
        }, (error) => {
            console.error("Error fetching rankings:", error);
        });

        return () => unsubscribe();
    }, [db, userId, isAuthReady]);

    // 6. Game End Handler (Defined first to resolve circular dependency)
    // 게임 종료 처리 (순환 종속성 해결을 위해 먼저 정의)
    const handleGameEnd = useCallback(async (isComplete) => {
        clearInterval(timerRef.current);
        setPhase('result');

        if (score > highScore) {
            setHighScore(score);
            setIsNewHighScore(true);

            if (db && userId) {
                try {
                    const userDocRef = doc(db, getPublicRankingPath(userId));
                    await updateDoc(userDocRef, {
                        highScore: score,
                        lastUpdated: new Date()
                    });
                } catch (error) {
                    console.error("High score update failed:", error);
                }
            }
        }
    }, [score, highScore, db, userId]);

    // Helper function to move to the next question
    // 다음 문제로 넘어가는 헬퍼 함수
    const handleNextQuestion = useCallback(() => {
        const nextIndex = currentQuestionIndex + 1;
        if (nextIndex < MAX_QUESTIONS) {
            setCurrentQuestionIndex(nextIndex);
            setTimeLeft(TIMER_START); // Reset timer
            setAnswerInput(''); // Clear input
        } else {
            handleGameEnd(true); // All questions completed
        }
    }, [currentQuestionIndex, handleGameEnd]);

    // --- Time Out Handler ---
    // 시간 초과 처리: 게임을 끝내지 않고 오답 처리 후 다음 문제로 넘어갑니다.
    const handleTimeOut = useCallback(() => {
        clearInterval(timerRef.current);
        
        if (!currentQuestion) return;
        
        const qData = currentQuestion[currentQuestionIndex];
        
        // Treat as wrong answer (No score loss, but marked as incorrect)
        setLastWrongInput('시간 초과'); // 오답 기록 대신 '시간 초과' 표시
        setCorrectAnswerText(qData.answer);
        setShowAnswer(true); 
        setFeedback({ text: '시간 초과!', type: 'wrong' }); // 피드백 표시
        
        // 2초 후 피드백 제거, 정답 숨기고 다음 문제로 이동
        setTimeout(() => {
            setFeedback({ text: '', type: '' });
            setShowAnswer(false);
            setCorrectAnswerText('');
            setLastWrongInput('');
            handleNextQuestion(); 
        }, 2000); 

    }, [currentQuestion, currentQuestionIndex, handleNextQuestion]);

    // 3. Timer Logic (Updated to use handleTimeOut)
    useEffect(() => {
        // 피드백이 표시되는 동안에는 타이머를 멈춥니다. (정답을 보여주는 2초 동안)
        if (phase === 'playing' && timeLeft > 0 && !feedback.text) { 
            timerRef.current = setInterval(() => {
                setTimeLeft(prev => prev - 1);
            }, 1000);
        } else if (phase === 'playing' && timeLeft === 0 && !feedback.text) {
            // 시간이 0이 되면 게임을 끝내는 대신 handleTimeOut을 호출하여 다음 문제로 넘어갑니다.
            clearInterval(timerRef.current);
            handleTimeOut(); 
        }
        return () => clearInterval(timerRef.current);
    }, [phase, timeLeft, feedback.text, handleTimeOut]); // handleTimeOut 추가

    // 4. Start Game
    const startGame = useCallback(() => {
        if (!isAuthReady) return;

        // Shuffle questions and select MAX_QUESTIONS
        // 문제 배열을 섞고 MAX_QUESTIONS 개만큼만 선택
        const shuffledQuestions = [...CHOSUNG_QUESTIONS].sort(() => Math.random() - 0.5);
        const gameQuestions = shuffledQuestions.slice(0, MAX_QUESTIONS);
        
        setCurrentQuestion(gameQuestions);
        setCurrentQuestionIndex(0);
        setScore(0);
        setAnswerInput('');
        setTimeLeft(TIMER_START);
        setFeedback({ text: '', type: '' });
        setShowAnswer(false); // Initialize
        setCorrectAnswerText(''); // Initialize
        setLastWrongInput(''); // 오답 기록 초기화
        setPhase('playing');
        setIsNewHighScore(false);
    }, [isAuthReady]);

    // 5. Handle Answer Submission (Includes logic to show answer on wrong attempt)
    // 정답 제출 처리 (오답 시 정답 표시 로직 포함)
    const handleSubmitAnswer = (e) => {
        e.preventDefault();
        // 피드백이 표시되고 있을 때는 제출 금지
        if (phase !== 'playing' || !currentQuestion || feedback.text) return; 

        const submittedAnswer = answerInput.trim().toLowerCase();
        const wrongInputForDisplay = answerInput.trim(); // 오답 표시를 위해 입력값 저장
        const qData = currentQuestion[currentQuestionIndex];
        const correctAnswer = qData.answer.trim().toLowerCase();
        
        setAnswerInput(''); // Clear input immediately

        if (submittedAnswer === correctAnswer) {
            // Correct Answer handling
            // 정답 처리
            const bonus = timeLeft * 1; // Bonus points based on remaining time
            const points = 10 + bonus;
            setScore(prev => prev + points);
            setFeedback({ text: `정답! (+${points}점)`, type: 'correct' });
            
            // Move to next question (short delay)
            // 다음 문제로 이동 (짧은 지연)
            setTimeout(() => {
                setFeedback({ text: '', type: '' });
                handleNextQuestion();
            }, 500);

        } else {
            // Wrong Answer handling: Show answer and move to next question
            // 오답 처리: 정답 표시 후 다음 문제로 이동
            setLastWrongInput(wrongInputForDisplay); // 오답 기록
            setCorrectAnswerText(qData.answer); // Store correct answer
            setShowAnswer(true); // Activate answer display
            setFeedback({ text: '오답!', type: 'wrong' });
            
            // Wait 2 seconds, then clear feedback, hide answer, and move on
            // 2초 대기 후 피드백 제거, 정답 숨기고 다음 문제로 이동
            setTimeout(() => {
                setFeedback({ text: '', type: '' });
                setShowAnswer(false);
                setCorrectAnswerText('');
                setLastWrongInput(''); // 오답 기록 초기화
                handleNextQuestion(); 
            }, 2000); // Show answer for 2 seconds
        }
    };

    // 7. Transition to Ranking Screen
    const showRanking = () => {
        setPhase('ranking');
    }

    // --- UI Rendering Functions ---

    const renderStartScreen = () => (
        <div className="flex flex-col items-center justify-center p-6 text-center">
            <h1 className="text-5xl font-extrabold text-orange-800 mb-4">초성 챌린지</h1>
            <p className="text-lg text-gray-700 mb-8">어휘력에 도전하고 랭킹을 올려보세요!</p>
            <div className="w-full max-w-sm p-4 bg-white rounded-xl shadow-lg mb-6 border border-amber-200">
                <p className="text-xl font-semibold text-gray-800">나의 최고 점수: <span className="text-red-700">{highScore}</span>점</p>
                <p className="text-sm text-gray-500 mt-1">로그인 닉네임: {nickname}</p>
            </div>
            
            <button 
                onClick={startGame} 
                className="w-full max-w-xs py-4 bg-red-800 hover:bg-red-900 text-white text-2xl font-bold rounded-full shadow-lg transform transition duration-150 active:scale-95"
            >
                게임 시작 (총 {MAX_QUESTIONS}문제)
            </button>
            <button 
                onClick={showRanking} 
                className="w-full max-w-xs mt-4 py-3 bg-amber-600 hover:bg-amber-700 text-white text-xl font-semibold rounded-full shadow-md transition duration-150 active:scale-95"
            >
                🏆 랭킹 보러가기
            </button>
            {!isAuthReady && <p className="mt-4 text-red-500">인증 중...</p>}
        </div>
    );

    const renderPlayingScreen = () => {
        if (!currentQuestion) return null;
        const qData = currentQuestion[currentQuestionIndex];
        // 진행률 계산: (현재 인덱스) / (총 문제 수) * 100
        const progress = ((currentQuestionIndex) / MAX_QUESTIONS) * 100;
        
        // 피드백이 표시될 때 (정답 표시 기간 2초) 입력 비활성화
        const isInputDisabled = !!feedback.text;

        return (
            <div className="flex flex-col h-full p-4">
                {/* Header and Timer */}
                <div className="flex justify-between items-center mb-6">
                    <div className="text-xl font-bold text-gray-700">SCORE: <span className="text-orange-700 text-3xl">{score}</span></div>
                    <div className="flex items-center space-x-2">
                        <span className="text-sm font-semibold text-gray-500">남은 시간:</span>
                        <div className={`text-4xl font-extrabold ${timeLeft <= 3 ? 'text-red-700 animate-pulse' : 'text-red-600'}`}>
                            {timeLeft}s
                        </div>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 bg-amber-200 rounded-full mb-6 overflow-hidden">
                    <div 
                        className="h-full bg-orange-500 transition-all duration-300 ease-out" 
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
                <p className="text-sm text-gray-500 mb-4 text-center">
                    {currentQuestionIndex + 1} / {MAX_QUESTIONS} 문제
                </p>

                {/* Question/Answer Area */}
                <div className="flex-grow flex flex-col items-center justify-center bg-white p-6 rounded-2xl shadow-xl border-4 border-amber-500">
                    <div className="text-md font-semibold text-amber-800 bg-amber-200 px-4 py-1 rounded-full mb-4">
                        카테고리: {qData.category}
                    </div>
                    {/* Display correct answer if showAnswer is true */}
                    {showAnswer ? (
                        <div className="text-5xl md:text-6xl font-black tracking-normal text-green-700 animate-fadeIn text-center">
                            {/* 오답을 작게 표시 */}
                            <p className="text-xl font-medium text-red-500 mb-4">
                                ❌ {lastWrongInput === '시간 초과' ? '시간 초과로 놓쳤습니다.' : `당신의 오답: "${lastWrongInput}"`}
                            </p>
                            
                            <span className="text-gray-500 text-xl">정답은</span><br/>
                            {correctAnswerText}
                        </div>
                    ) : (
                        <div className="8xl md:text-9xl font-black tracking-widest text-gray-800 animate-fadeIn">
                            {qData.chosung}
                        </div>
                    )}
                </div>

                {/* Local Feedback Indicator (Replaces the screen-blocking modal) */}
                {feedback.text && (
                    <div className={`mt-4 p-3 rounded-xl text-center font-bold text-2xl transition-all duration-300 animate-fadeIn ${
                        feedback.type === 'correct' ? 'bg-green-100 text-green-700 border-2 border-green-300' : 'bg-red-100 text-red-700 border-2 border-red-300'
                    }`}>
                        {feedback.text}
                    </div>
                )}

                {/* Input and Submit Form */}
                <form onSubmit={handleSubmitAnswer} className="mt-6">
                    <input
                        type="text"
                        value={answerInput}
                        onChange={(e) => setAnswerInput(e.target.value)}
                        placeholder="정답을 입력하세요..."
                        className="w-full p-4 border-4 border-orange-300 rounded-xl text-xl text-center focus:border-orange-500 focus:outline-none transition duration-150"
                        autoFocus
                        disabled={isInputDisabled}
                    />
                    <button
                        type="submit"
                        disabled={answerInput.trim().length === 0 || isInputDisabled}
                        className="w-full mt-3 py-4 bg-red-600 hover:bg-red-700 text-white text-xl font-bold rounded-xl shadow-lg disabled:bg-gray-400 transform transition duration-150 active:scale-95"
                    >
                        정답 제출
                    </button>
                </form>
            </div>
        );
    };

    const renderResultScreen = () => (
        <div className="flex flex-col items-center justify-center p-6 text-center">
            <h1 className="text-5xl font-extrabold text-gray-800 mb-6">게임 결과</h1>
            
            <div className="bg-white p-8 rounded-2xl shadow-2xl border-4 border-red-700 w-full max-w-sm">
                <p className="text-lg text-gray-600 mb-3">최종 점수</p>
                <div className="text-7xl font-black text-orange-800 mb-4 animate-scorePop">
                    {score}
                </div>
                
                {isNewHighScore && (
                    <div className="text-xl font-bold text-yellow-600 bg-yellow-100 p-2 rounded-lg mb-6 shadow-md animate-bounce">
                        🎉 최고 점수 갱신!
                    </div>
                )}
                
                <p className="text-lg text-gray-600 mt-4">기존 최고 점수: {highScore - (isNewHighScore ? score : 0)}점</p>
                <p className="text-lg text-gray-600">나의 현재 최고 점수: {highScore}점</p>
            </div>
            
            <button 
                onClick={startGame} 
                className="w-full max-w-sm mt-8 py-4 bg-red-800 hover:bg-red-900 text-white text-xl font-bold rounded-full shadow-lg transform transition duration-150 active:scale-95"
            >
                다시 시작
            </button>
            <button 
                onClick={showRanking} 
                className="w-full max-w-sm mt-3 py-3 bg-amber-600 hover:bg-amber-700 text-white text-lg font-semibold rounded-full shadow-md transition duration-150 active:scale-95"
            >
                🏆 랭킹 보러가기
            </button>
        </div>
    );

    const renderRankingScreen = () => (
        <div className="p-4 flex flex-col h-full">
            <h1 className="text-4xl font-extrabold text-orange-700 mb-6 text-center">🏆 글로벌 랭킹 보드</h1>
            
            <div className="bg-white p-4 rounded-xl shadow-xl mb-4 border border-amber-200">
                <p className="text-lg font-bold text-gray-800">
                    나의 닉네임: <span className="text-red-700">{nickname}</span>
                </p>
                {myRank ? (
                    <p className="text-sm text-gray-600">
                        현재 나의 순위: <span className="font-bold text-xl text-red-500">{myRank.rank}위</span> (최고 점수: {myRank.score}점)
                    </p>
                ) : (
                    <p className="text-sm text-gray-600">랭킹 정보 로딩 중이거나 아직 최고 점수가 없습니다.</p>
                )}
            </div>

            {/* Ranking List Header */}
            <div className="flex font-bold text-lg text-white bg-red-800 p-3 rounded-t-lg">
                <span className="w-1/6 text-center">순위</span>
                <span className="w-4/6 pl-2">닉네임</span>
                <span className="w-1/6 text-right">점수</span>
            </div>

            {/* Ranking List */}
            <div className="flex-grow overflow-y-auto bg-white rounded-b-xl shadow-inner border border-gray-200">
                {rankingData.length === 0 ? (
                    <p className="p-4 text-center text-gray-500">랭킹 데이터가 없습니다. 게임을 플레이하고 첫 점수를 등록해보세요!</p>
                ) : (
                    rankingData.map((user, index) => (
                        <div 
                            key={user.userId} 
                            className={`flex items-center p-3 border-b last:border-b-0 transition duration-150 ${user.userId === userId ? 'bg-red-100 font-bold border-l-4 border-red-500' : 'hover:bg-amber-50'}`}
                        >
                            <span className="w-1/6 text-center text-xl">
                                {index < 3 ? '🥇🥈🥉'[index] : index + 1}
                            </span>
                            <span className="w-4/6 pl-2 truncate text-gray-800">
                                {user.nickname}
                            </span>
                            <span className="w-1/6 text-right font-semibold text-gray-700">
                                {user.highScore}
                            </span>
                        </div>
                    ))
                )}
            </div>
            
            <button 
                onClick={() => setPhase('start')} 
                className="w-full mt-4 py-3 bg-orange-800 hover:bg-orange-900 text-white text-lg font-semibold rounded-full shadow-md transition duration-150 active:scale-95"
            >
                게임 메인으로 돌아가기
            </button>
        </div>
    );

    // Main Component Rendering
    // 메인 컴포넌트 렌더링
    let content;
    switch (phase) {
        case 'playing':
            content = renderPlayingScreen();
            break;
        case 'result':
            content = renderResultScreen();
            break;
        case 'ranking':
            content = renderRankingScreen();
            break;
        case 'start':
        default:
            content = renderStartScreen();
    }

    return (
        // Autumn Warm Tone Background (bg-amber-50)
        // 배경색을 가을 웜톤에 맞게 변경 (bg-amber-50)
        <div className="min-h-screen bg-amber-50 flex items-center justify-center p-4">
            <style>{` 
                /* Font import for better Korean display */
                @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100..900&display=swap');
                body {
                    font-family: 'Noto Sans KR', sans-serif;
                }
                .animate-scorePop {
                    animation: scorePop 0.5s ease-out;
                }
                @keyframes scorePop {
                    0% { transform: scale(0.8); opacity: 0; }
                    50% { transform: scale(1.1); opacity: 1; }
                    100% { transform: scale(1); }
                }
                .animate-fadeIn {
                    animation: fadeIn 0.5s ease-in-out;
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            `}</style>
            <div className="w-full max-w-lg min-h-[600px] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
                {content}
            </div>
        </div>
    );
};

export default App;
